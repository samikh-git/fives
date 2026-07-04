import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "../../../src/shared/types";
import type { ChatEntry, ClientMessage, ErrorMessage, ServerMessage } from "../../../src/shared/protocol";

export interface UseGameSocketResult {
  state: GameState | null;
  error: ErrorMessage | null;
  chatMessages: ChatEntry[];
  proposeNextPlayer: () => void;
  placeBid: (amount: number) => void;
  pass: () => void;
  sendChat: (text: string) => void;
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
 * Reconnect policy (v1, deliberately simple): if the socket closes
 * unexpectedly, we immediately retry the connection exactly once using the
 * same token. If that retry also closes, we give up silently rather than
 * looping forever - a full reconnect-with-backoff strategy is left for a
 * later iteration once real-world drop patterns are known. We rely on the
 * server re-sending a state_snapshot after reconnecting rather than trying
 * to reconcile any state ourselves.
 */
export function useGameSocket(
  gameId: string | null,
  token: string | null,
  name: string | null = null,
): UseGameSocketResult {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!gameId || !token) return;

    let cancelled = false;
    let hasRetried = false;

    const connect = () => {
      const ws = new WebSocket(buildWsUrl(gameId, token, name));
      wsRef.current = ws;

      ws.onmessage = (event: { data: string }) => {
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
        if (cancelled) return;
        if (!hasRetried) {
          hasRetried = true;
          connect();
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
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

  return { state, error, chatMessages, proposeNextPlayer, placeBid, pass, sendChat };
}
