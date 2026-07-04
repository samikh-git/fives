import { describe, expect, it, beforeAll, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import schema from "../db/schema.sql?raw";
import { sendVotingClosedNotifications } from "./notify";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    RESEND_API_KEY: string;
    RESEND_FROM_ADDRESS: string;
    APP_BASE_URL: string;
  }
}

beforeAll(async () => {
  const statements = (schema as string)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

async function insertClosedGame(
  id: string,
  overrides: { notifyA?: string | null; notifyB?: string | null; notified?: boolean } = {},
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO games (id, status, captain_a_token, created_at, completed_at, published_at, public_slug, voting_closes_at, captain_a_notify_email, captain_b_notify_email, voting_closed_notified_at)
     VALUES (?, 'completed', 'tok', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      now - 10000,
      now - 10000,
      now - 10000,
      `${id}-slug`,
      now - 1000,
      overrides.notifyA ?? null,
      overrides.notifyB ?? null,
      overrides.notified ? now - 500 : null,
    )
    .run();
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendVotingClosedNotifications", () => {
  it("does nothing for a closed game where neither captain opted in", async () => {
    await insertClosedGame("notify-none");

    const count = await sendVotingClosedNotifications(env.DB, env);
    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one email per opted-in captain via the Resend API and stamps voting_closed_notified_at", async () => {
    await insertClosedGame("notify-both", { notifyA: "a@example.com", notifyB: "b@example.com" });

    const count = await sendVotingClosedNotifications(env.DB, env);
    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${env.RESEND_API_KEY}` });

    const row = await env.DB.prepare("SELECT voting_closed_notified_at FROM games WHERE id = ?")
      .bind("notify-both")
      .first<{ voting_closed_notified_at: number | null }>();
    expect(row?.voting_closed_notified_at).not.toBeNull();
  });

  it("sends only to the captain who opted in", async () => {
    await insertClosedGame("notify-one", { notifyA: "a@example.com" });

    await sendVotingClosedNotifications(env.DB, env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.to).toEqual(["a@example.com"]);
  });

  it("does not re-notify a game that was already notified", async () => {
    await insertClosedGame("notify-already", { notifyA: "a@example.com", notified: true });

    const count = await sendVotingClosedNotifications(env.DB, env);
    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not act on a game whose voting window hasn't closed yet", async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO games (id, status, captain_a_token, created_at, completed_at, published_at, public_slug, voting_closes_at, captain_a_notify_email)
       VALUES (?, 'completed', 'tok', ?, ?, ?, ?, ?, ?)`,
    )
      .bind("notify-open", now, now, now, "notify-open-slug", now + 60_000, "a@example.com")
      .run();

    const count = await sendVotingClosedNotifications(env.DB, env);
    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
