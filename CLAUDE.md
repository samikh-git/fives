# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build              # vite build (frontend) -> ../dist, served by the Worker's assets binding
npm run dev                 # wrangler dev — single process serving API + DO + built frontend on :8787
npm test                    # full suite: jsdom/pure-fn tests, then Workers-runtime tests
npm run test:unit           # vitest --config vitest.config.ts (frontend/src + src/shared, jsdom)
npm run test:workers        # vitest --config vitest.workers.config.ts (src/, real D1/DO via vitest-pool-workers)
npx tsc --noEmit             # typecheck the whole repo (frontend + src share one tsconfig)
npm run db:migrate:local     # applies src/db/schema.sql to the local D1 instance
npm run deploy                # build + wrangler deploy --env production (uses the `env.production` block in wrangler.jsonc)
```

Run a single test file: `npx vitest run --config vitest.config.ts path/to/file.test.tsx` (or swap in `vitest.workers.config.ts` for anything under `src/`). There is no separate lint script.

For active frontend development with hot reload, run `wrangler dev` (port 8787) and `cd frontend && npx vite` (port 5173) side by side — `frontend/vite.config.ts` proxies `/api` and `/ws` from Vite's dev server to the Worker. This is a dev-only convenience; in the built/deployed app there is exactly one Worker serving everything (API, WebSocket upgrades, and the static SPA) from one origin.

## Architecture

**Fives** is a 2-captain live bidding draft for 5-a-side soccer squads: two captains draft 5 players each from a shared pool of exactly 10, via alternating turn-based bidding, on Cloudflare Workers + Durable Objects + D1. There are no user accounts — captain identity is a bearer token embedded in a join link.

### Two test configs, two runtimes
`vitest.config.ts` (jsdom + `@testing-library/react`) covers `frontend/src/**` and `src/shared/**` — pure functions and presentational/hook code with mocked WebSocket/fetch. `vitest.workers.config.ts` (`@cloudflare/vitest-pool-workers`) covers everything else under `src/` and runs against **real** D1 and Durable Object bindings defined in `wrangler.jsonc` — these are integration tests, not mocks. When adding a test, put it in the config that matches what it touches; `src/shared/*.test.ts` is deliberately excluded from the workers config.

### Request routing (`src/index.ts`)
A single Hono app mounts four independent sub-routers: `playersRouter` (`/api/players`), `playersAdminRouter` (`/api/admin/players`, `src/routes/players-admin.ts`), `gamesRouter` (`/api/games`), and `wsRouter` (`/ws/games`) — then falls through to `env.ASSETS.fetch()` (Workers static assets, SPA fallback) for everything else. Each router is self-contained and independently testable via `router.request(...)` without booting the full app — keep new route groups structured this way rather than adding routes directly to `index.ts`.

The `Env` bindings (`src/index.ts`) are: `DB` (D1), `GAME_ROOM` (DO namespace), `ASSETS`, `PLAYER_IMAGES` (R2 bucket for roster player photos), `CREATE_GAME_RATE_LIMITER` (Workers rate limiting, 5 req/60s per client IP, enforced in `routes/games.ts`'s `POST /`), `THESPORTSDB_API_KEY` (optional, used by `players-admin` to import league/team/player data from TheSportsDB), and `APP_BASE_URL`.

### `GameRoom` Durable Object (`src/durable-objects/game-room.ts`) — the authoritative game engine
One DO instance per game (keyed by `idFromName(gameId)`). Core game logic lives in plain async methods (`init`, `handleCaptainConnected`, `proposeNextPlayer`, `placeBid`, `pass`, `getState`, `getCaptainForToken`) that return an `ActionResult<GameState> = {ok:true,state} | {ok:false,code,message}` rather than throwing — throwing custom errors across the DO RPC boundary was found to crash `vitest-pool-workers`' isolated-storage bookkeeping, so this return-based pattern is load-bearing, not stylistic. Two more methods follow the same pattern for auxiliary features: `setCaptainName(captain, name)` (display-name, sanitized + profanity-checked) and `sendChatMessage(captain, text)` (in-game chat, capped at `MAX_CHAT_HISTORY` = 200 entries, also sanitized/profanity-checked). All of these are callable directly (cross-file RPC from `routes/games.ts`, or via `runInDurableObject`/direct stub calls in tests) and back the thin WebSocket layer (`fetch`/`webSocketMessage`/`webSocketClose`, using the Hibernation API via `ctx.acceptWebSocket`). The DO also registers a Hibernation-API auto-response (`ctx.setWebSocketAutoResponse`) so ping/pong heartbeats are answered without waking the DO.

State is persisted as a single JSON blob in the DO's own SQLite storage (`ctx.storage.sql`), written synchronously on every mutation with no in-memory-only cache — every read goes back to storage. This means a hibernation evict/reload cycle can't lose state, at the cost of re-parsing JSON per call (acceptable at this scale).

**Critical protocol detail**: every mutating WebSocket message handler (`propose_next_player`, `place_bid`, `pass`) broadcasts its specific event (`round_started`, `bid_placed`, `round_settled`, `game_completed`) **and then** broadcasts a fresh `state_snapshot`. The frontend's `useGameSocket` hook only updates displayed state on `state_snapshot` — it intentionally does not hand-parse the granular events into partial state updates, relying on the server being authoritative. If you add a new mutating message type, it must end with a `state_snapshot` broadcast or the UI will silently stop updating. Non-game-state events (`captain_joined`, `game_started`, `chat_message`, and `chat_history` sent once on connect) don't carry state and aren't subject to this rule.

### Shared contracts (`src/shared/`) — the interface both sides code against
- `constants.ts`: `STARTING_BUDGET` (250,000,000), `MIN_BID_INCREMENT` (5,000,000), `POOL_SIZE` (10), `SQUAD_SIZE` (5), `MIN_GOALIES_IN_POOL` (2), plus field-length caps (`MAX_CAPTAIN_NAME_LENGTH`, `MAX_CHAT_MESSAGE_LENGTH`, `MAX_PLAYER_NAME_LENGTH`, `MAX_LEAGUE_NAME_LENGTH`, `MAX_CLUB_NAME_LENGTH`, `MAX_NATION_NAME_LENGTH`, `MAX_IMAGE_URL_LENGTH`) and roster pagination sizes (`ROSTER_PAGE_SIZE`, `MAX_ROSTER_PAGE_SIZE`).
- `types.ts` / `protocol.ts`: `GameState`, `RoundState`, and the full `ClientMessage`/`ServerMessage` discriminated unions — including `join` and `send_chat` client messages, and `captain_joined`/`game_started`/`chat_message`/`chat_history` server messages alongside the core game-state ones. `Player` also carries `league`, `externalId`, and `archivedAt`.
- `rules.ts`: `computeReserve`/`computeMaxLegalBid`/`isLegalBid` — the reserve-rule math (a captain can never bid more than `budget - (slots still needed after this player) × minIncrement`). This is imported by both the DO (authoritative enforcement) and the frontend (`BidControls`, for instant UX clamping only — the server is what actually enforces it).
- `sanitize.ts` (`sanitizeText`) and `moderation.ts` (`containsProfanity`): shared text-cleaning used for captain names and chat messages, called from both the DO and `players-admin`.

Import from `src/shared/` rather than redefining these types locally; frontend files reach it via relative paths like `../../../src/shared/...` since `frontend/` and `src/` are separate root-ish trees under one tsconfig.

### Game rules encoded in the state machine
Round order is fully randomized once at game creation and fixed as `proposalOrder` on each pool entry. The "first bidder" for each round alternates every round (round 1's first bidder is a one-time coin flip stored at creation). The first bidder **must** place an opening bid — passing is only legal in the `awaiting_response` subphase, which structurally rules out "pass with nothing on the table" rather than special-casing it. A pass settles the round: the player goes to whoever holds `currentBid`, at that price.

### Game creation (`routes/games.ts`)
`POST /api/games` builds the 10-player pool one of two ways: a **random draw**, optionally filtered by `leagues`/`clubs`/`nations`, or a captain **hand-picked pool** via `selectedPlayerIds` (exactly `POOL_SIZE` unique ids). Both paths enforce `MIN_GOALIES_IN_POOL`. Game ids are human-readable two-word slugs (`src/lib/slug.ts`'s `generateGameSlug`, e.g. `swift-otter`) generated with a collision-retry loop against D1, falling back to a UUID after `MAX_SLUG_ATTEMPTS`. Creation is rate-limited via `CREATE_GAME_RATE_LIMITER` (5/min per client IP).

### D1 schema (`src/db/schema.sql`)
`players` (soft-delete via `archived_at`, never hard-deleted — historical games must still resolve archived players by id; also carries `external_id` (unique, from TheSportsDB imports), `league`, `image_url`), `games`, `game_pool` (the 10-player draw + its randomized order for one game), `game_players` (final result, written by the DO when a game completes). `games` has unused `published_at`/`public_slug` columns reserved for a not-yet-built "publish results publicly for voting" feature — don't repurpose them.

### Player images (`routes/players.ts`, R2)
Roster player photos are served from the `PLAYER_IMAGES` R2 bucket at `GET /api/players/images/:key` (strict key format, immutable caching). `players-admin.ts` handles uploads/imports, including pulling player data and images from TheSportsDB by league/team when `THESPORTSDB_API_KEY` is configured.

### Frontend structure
`frontend/src/router.tsx` wires five routes: `/` (marketing home page), `/roster`, `/games/new`, `/game/:gameId/join`, and `/game/:gameId`, to pages in `frontend/src/pages/`. Captain identity/session is `frontend/src/lib/session.ts` (localStorage, keyed by `gameId`, storing `{token, role, joinUrlForB?, name?}`) — there are no accounts; `POST /api/games` mints both captain tokens upfront, and the join URL embeds captain B's token as `?t=`.

`frontend/src/hooks/useGameSocket.ts` is the sole place that opens/reconnects the game WebSocket. It reconnects indefinitely with exponential backoff (starting at 500ms, doubling up to a 10s cap), runs a client-side heartbeat (ping every 15s when idle, force-closing the socket if no pong arrives within 5s), and resets/re-probes the connection on `visibilitychange` when the tab regains focus. (This replaced an earlier one-shot-retry policy — don't assume the simpler behavior described in old commit messages still applies.)

Styling lives in `frontend/src/styles.css` (a single ~1500-line stylesheet, "stadium/matchday" visual theme) — the app is **not** unstyled; earlier notes calling it "bare semantic HTML" are stale. Notable components beyond the core pages: `ChatModal.tsx` (in-game chat UI, paired with the DO's chat feature and `lib/chatToggleSlot.ts`), `AddPlayerModal.tsx`, `Modal.tsx`, `PlayerCard.tsx`, `BidControls.tsx`, `BudgetPanel.tsx`, `ResultsTable.tsx`, `SquadPanel.tsx`, and `lib/api/{games,players}.ts` for typed fetch wrappers.
