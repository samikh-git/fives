import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGameSocket } from "./useGameSocket";
import type { GameState } from "../../../src/shared/types";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  // test helpers
  triggerOpen() {
    this.onopen?.();
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerClose() {
    this.onclose?.();
  }
}

const sampleState: GameState = {
  gameId: "game-1",
  phase: "in_progress",
  captainAConnected: true,
  captainBConnected: true,
  captainNames: { A: null, B: null },
  pool: [],
  nextProposalIndex: 0,
  budgets: { A: 250_000_000, B: 250_000_000 },
  squadCounts: { A: 0, B: 0 },
  squads: { A: [], B: [] },
  lastRoundFirstBidder: null,
  round: null,
  publishConsent: { A: false, B: false },
  publicSlug: null,
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGameSocket", () => {
  it("starts with null state and no error", () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));

    expect(result.current.state).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("updates state on state_snapshot messages", async () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      socket.triggerMessage({ type: "state_snapshot", state: sampleState });
    });

    await waitFor(() => {
      expect(result.current.state).toEqual(sampleState);
    });
  });

  it("sends a correctly-shaped place_bid message", () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      result.current.placeBid(15_000_000);
    });

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "place_bid", amount: 15_000_000 });
  });

  it("sends propose_next_player and pass messages", () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      result.current.proposeNextPlayer();
      result.current.pass();
    });

    expect(socket.sent.map((s) => JSON.parse(s))).toEqual([
      { type: "propose_next_player" },
      { type: "pass" },
    ]);
  });

  it("surfaces an error message without clearing existing game state", async () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      socket.triggerMessage({ type: "state_snapshot", state: sampleState });
    });
    await waitFor(() => expect(result.current.state).toEqual(sampleState));

    act(() => {
      socket.triggerMessage({ type: "error", code: "NOT_YOUR_TURN", message: "not your turn" });
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({
        type: "error",
        code: "NOT_YOUR_TURN",
        message: "not your turn",
      });
    });
    expect(result.current.state).toEqual(sampleState);
  });

  it("replaces chat history on chat_history and appends on chat_message", async () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      socket.triggerMessage({
        type: "chat_history",
        entries: [{ id: "1", captain: "A", text: "hi", ts: 1 }],
      });
    });
    await waitFor(() => expect(result.current.chatMessages).toHaveLength(1));

    act(() => {
      socket.triggerMessage({
        type: "chat_message",
        entry: { id: "2", captain: "B", text: "hey", ts: 2 },
      });
    });

    await waitFor(() => {
      expect(result.current.chatMessages).toEqual([
        { id: "1", captain: "A", text: "hi", ts: 1 },
        { id: "2", captain: "B", text: "hey", ts: 2 },
      ]);
    });
  });

  it("sends a correctly-shaped send_chat message", () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      result.current.sendChat("gg");
    });

    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "send_chat", text: "gg" });
  });

  it("sends a request_publish message, with notifyEmail omitted when not given", () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      result.current.requestPublish();
    });

    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "request_publish" });
  });

  it("sends a request_publish message with the given notifyEmail", () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      result.current.requestPublish("a@example.com");
    });

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: "request_publish",
      notifyEmail: "a@example.com",
    });
  });

  it("keeps reconnecting with backoff across repeated closes, not just once", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useGameSocket("game-1", "token-1"));
      expect(FakeWebSocket.instances).toHaveLength(1);

      // First drop: retries after the initial backoff delay.
      act(() => {
        FakeWebSocket.instances[0]!.triggerClose();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(FakeWebSocket.instances).toHaveLength(2);

      // Second drop in a row used to be where the old policy gave up for good.
      act(() => {
        FakeWebSocket.instances[1]!.triggerClose();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(FakeWebSocket.instances).toHaveLength(3);

      // A third drop still reconnects rather than going silent.
      act(() => {
        FakeWebSocket.instances[2]!.triggerClose();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(FakeWebSocket.instances).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reflects connected state through open/close cycles", async () => {
    const { result } = renderHook(() => useGameSocket("game-1", "token-1"));

    expect(result.current.connected).toBe(false);

    act(() => {
      FakeWebSocket.instances[0]!.triggerOpen();
    });
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      FakeWebSocket.instances[0]!.triggerClose();
    });
    await waitFor(() => expect(result.current.connected).toBe(false));
  });
});
