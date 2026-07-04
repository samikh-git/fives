import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "../../../src/shared/types";
import { PING_PAYLOAD, PONG_PAYLOAD } from "../../../src/shared/protocol";
import type { ChatEntry, ClientMessage, ErrorMessage, ServerMessage } from "../../../src/shared/protocol";

export interface UseGameSocketResult {
  state: GameState | null;
  error: ErrorMessage | null;
  chatMessages: ChatEntry[];
  connected: boolean;
  proposeNextPlayer: () => void;
  placeBid: (amount: number) => void;
  pass: () => void;
  sendChat: (text: string) => void;
  requestPublish: (notifyEmail?: string) => void;
  dismissError: () => void;
}

const MAX_RECONNECT_DELAY_MS = 10_000;
/** How long the connection may sit idle before we proactively probe it with a ping. */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** How long we wait for a pong before treating the socket as silently dead. */
const PONG_TIMEOUT_MS = 5_000;

/** Exponential-ish backoff: 0.5s, 1s, 2s, 4s, ... capped at MAX_RECONNECT_DELAY_MS. */
function reconnectDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

function buildWsUrl(gameId: string, token: string, name: string | null): string {
  const query = name ? `?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}` : `?token=${encodeURIComponent(token)}`;
  if (typeof window === "undefined") {
    return `ws://localhost/ws/games/${gameId}${query}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws/games/${gameId}${query}`;
}

/**
 * Opens (and keeps open) a WebSocket connection to a game room, exposing the
 * latest authoritative GameState broadcast by the server plus dispatchers for
 * the client actions.
 *
 * Reconnect policy: if the socket closes unexpectedly, we keep retrying with
 * capped exponential backoff for as long as the hook is mounted, rather than
 * giving up after a fixed number of attempts - a single transient drop (WiFi
 * blip, laptop sleep, mobile network switch) shouldn't strand a captain mid-draft
 * with a tab that silently stops updating until they think to reload. `connected`
 * reflects whether the socket is currently open, so callers can show a banner
 * during a reconnect. We rely on the server re-sending a state_snapshot (and
 * chat_history) after each reconnect rather than trying to reconcile state
 * ourselves.
 *
 * A socket can also look open while actually being dead - e.g. a phone locks
 * or the OS backgrounds the tab and a carrier's NAT silently drops an idle
 * connection without ever firing a close/error event. To catch that we probe
 * with a heartbeat ping (answered by the DO's setWebSocketAutoResponse without
 * waking it) whenever the connection has been idle, and again immediately when
 * the tab regains visibility; a missed pong force-closes the socket so the
 * existing backoff reconnect above takes over.
 */
export function useGameSocket(
  gameId: string | null,
  token: string | null,
  name: string | null = null,
): UseGameSocketResult {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!gameId || !token) return;

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let checkConnectionAlive: (() => void) | null = null;

    const connect = () => {
      const ws = new WebSocket(buildWsUrl(gameId, token, name));
      wsRef.current = ws;

      let lastActivity = Date.now();
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let pongTimer: ReturnType<typeof setTimeout> | undefined;

      const sendPing = () => {
        ws.send(PING_PAYLOAD);
        pongTimer = setTimeout(() => {
          // No pong within the timeout: the socket looks open but is dead
          // (e.g. a carrier NAT silently dropped an idle connection) - force
          // a reconnect via the existing onclose backoff path.
          ws.close();
        }, PONG_TIMEOUT_MS);
      };

      checkConnectionAlive = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sendPing();
      };

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        lastActivity = Date.now();
        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastActivity >= HEARTBEAT_INTERVAL_MS) {
            sendPing();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event: { data: string }) => {
        lastActivity = Date.now();
        if (event.data === PONG_PAYLOAD) {
          clearTimeout(pongTimer);
          return;
        }
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "state_snapshot") {
          setState(message.state);
        } else if (message.type === "chat_history") {
          setChatMessages(message.entries);
        } else if (message.type === "chat_message") {
          setChatMessages((prev) => [...prev, message.entry]);
        } else if (message.type === "error") {
          // WRONG_SUBPHASE from propose_next_player only happens when both
          // captains' clients auto-propose the next player at once and lose
          // a harmless race - the other client's proposal already went
          // through, so there's nothing wrong to surface here.
          if (message.code === "WRONG_SUBPHASE") return;
          setError(message);
        }
      };

      ws.onclose = () => {
        clearInterval(heartbeatTimer);
        clearTimeout(pongTimer);
        checkConnectionAlive = null;
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, reconnectDelay(attempt));
        attempt += 1;
      };
    };

    connect();

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back to the foreground is a good moment to verify the socket
      // is actually alive rather than waiting for the next scheduled
      // heartbeat tick; treat it as a fresh start for backoff too, since
      // this is a proactive check, not a failure streak.
      attempt = 0;
      checkConnectionAlive?.();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wsRef.current?.close();
    };
  }, [gameId, token, name]);

  const send = useCallback((message: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(message));
  }, []);

  const proposeNextPlayer = useCallback(
    () => send({ type: "propose_next_player" }),
    [send],
  );
  const placeBid = useCallback(
    (amount: number) => send({ type: "place_bid", amount }),
    [send],
  );
  const pass = useCallback(() => send({ type: "pass" }), [send]);
  const sendChat = useCallback((text: string) => send({ type: "send_chat", text }), [send]);
  const requestPublish = useCallback(
    (notifyEmail?: string) => send({ type: "request_publish", notifyEmail }),
    [send],
  );
  const dismissError = useCallback(() => setError(null), []);

  return {
    state,
    error,
    chatMessages,
    connected,
    proposeNextPlayer,
    placeBid,
    pass,
    sendChat,
    requestPublish,
    dismissError,
  };
}
