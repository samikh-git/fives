# AGENTS.md

Guidance for AI coding agents working in this repository.

## Commands

```bash
npm run build              # vite build (frontend) -> ../dist, served by the Worker's assets binding
npm run dev                 # wrangler dev — single process serving API + DO + built frontend on :8787
npm test                    # full suite: jsdom/pure-fn tests, then Workers-runtime tests
npm run test:unit           # vitest --config vitest.config.ts (frontend/src + src/shared, jsdom)
npm run test:workers        # vitest --config vitest.workers.config.ts (src/, real D1/DO via vitest-pool-workers)
npx tsc --noEmit             # typecheck the whole repo (frontend + src share one tsconfig)
npm run db:migrate:local     # applies src/db/schema.sql to the local D1 instance
```

Run a single test file: `npx vitest run --config vitest.config.ts path/to/file.test.tsx` (swap in `vitest.workers.config.ts` for anything under `src/`). There is no separate lint script.

Always run `npm test` and `npx tsc --noEmit` before considering a change done. This project was built test-first (see below) — new code should follow the same pattern: write the failing test, confirm it fails for the right reason, then implement.

## Architecture

**Fives** is a 2-captain live bidding draft for 5-a-side soccer squads on Cloudflare Workers + Durable Objects + D1. Two captains draft 5 players each from a shared pool of exactly 10, via alternating turn-based bidding. There are no user accounts — captain identity is a bearer token embedded in a join link.

### Two test configs, two runtimes
`vitest.config.ts` (jsdom + `@testing-library/react`) covers `frontend/src/**` and `src/shared/**`. `vitest.workers.config.ts` (`@cloudflare/vitest-pool-workers`) covers everything else under `src/` and runs against **real** D1 and Durable Object bindings from `wrangler.jsonc` — these are integration tests, not mocks. Match new tests to the config that fits what they touch.

### Request routing (`src/index.ts`)
A single Hono app mounts three independent sub-routers exported from `src/routes/{players,games,ws}.ts`, then falls through to `env.ASSETS.fetch()` for everything else (SPA fallback). Each router is self-contained and testable via `router.request(...)` without booting the full app — add new route groups the same way rather than putting logic directly in `index.ts`.

### `GameRoom` Durable Object (`src/durable-objects/game-room.ts`) — the authoritative game engine
One instance per game (`idFromName(gameId)`). Game logic lives in plain async methods (`init`, `handleCaptainConnected`, `proposeNextPlayer`, `placeBid`, `pass`, `getState`, `getCaptainForToken`) that return `ActionResult<GameState> = {ok:true,state} | {ok:false,code,message}` instead of throwing. This is a deliberate workaround: throwing custom errors across the DO RPC boundary crashed `vitest-pool-workers`'s isolated-storage bookkeeping, so the return-based pattern must be kept if you touch these methods. They're callable directly (cross-file RPC, or `runInDurableObject`/stub calls in tests) and back the thin WebSocket layer (`fetch`/`webSocketMessage`/`webSocketClose`, using the Hibernation API via `ctx.acceptWebSocket`).

State is one JSON blob in the DO's own SQLite storage, written synchronously on every mutation, with every read going back to storage (no in-memory cache) — this is what makes state survive hibernation evictions.

**Load-bearing protocol detail**: every mutating WS handler (`propose_next_player`, `place_bid`, `pass`) broadcasts its specific event (`round_started`, `bid_placed`, `round_settled`, `game_completed`) **and then** a fresh `state_snapshot`. The frontend's `useGameSocket` hook only updates displayed state on `state_snapshot` — it does not hand-parse the granular events. Any new mutating message type must end with a `state_snapshot` broadcast or the UI silently stops updating (this exact bug was caught during integration testing).

### Shared contracts (`src/shared/`)
- `constants.ts`: `STARTING_BUDGET` (250,000,000), `MIN_BID_INCREMENT` (5,000,000), `POOL_SIZE` (10), `SQUAD_SIZE` (5), `MIN_GOALIES_IN_POOL` (2).
- `types.ts` / `protocol.ts`: `GameState`, `RoundState`, the full `ClientMessage`/`ServerMessage` discriminated unions.
- `rules.ts`: `computeReserve`/`computeMaxLegalBid`/`isLegalBid` — a captain can never bid more than `budget - (slots still needed after this player) × minIncrement`. Imported by both the DO (authoritative enforcement) and the frontend (`BidControls`, UX clamping only).

Import from `src/shared/` rather than redefining types locally.

### Game rules encoded in the state machine
Round order is randomized once at game creation (`proposalOrder` on each pool entry). The "first bidder" alternates every round (round 1 is a one-time coin flip stored at creation). The first bidder must place an opening bid — passing is only legal in the `awaiting_response` subphase, which structurally rules out "pass with nothing on the table." A pass settles the round to whoever holds `currentBid`, at that price.

### D1 schema (`src/db/schema.sql`)
`players` (soft-delete via `archived_at` — never hard-delete; historical games must still resolve archived players by id), `games`, `game_pool` (one game's 10-player draw + order), `game_players` (final result, written by the DO on completion). `games.published_at`/`public_slug` are unused columns reserved for a not-yet-built "publish results for public voting" feature — leave them alone unless you're building that feature.

### Frontend structure
`frontend/src/router.tsx` wires four routes (`/roster`, `/games/new`, `/game/:gameId/join`, `/game/:gameId`). Captain identity is `frontend/src/lib/session.ts` (localStorage keyed by `gameId`, storing `{token, role}`) — no accounts; `POST /api/games` mints both captain tokens upfront, and the join URL embeds captain B's token as `?t=`. `frontend/src/hooks/useGameSocket.ts` is the only place that opens/reconnects the game WebSocket (reconnect policy: one immediate retry on unexpected close, then give up). No CSS has been added anywhere — components are unstyled semantic HTML by choice so far, not oversight.
