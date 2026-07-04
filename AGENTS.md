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
npm run deploy                # build + wrangler deploy --env production (uses the `env.production` block in wrangler.jsonc)
```

Run a single test file: `npx vitest run --config vitest.config.ts path/to/file.test.tsx` (swap in `vitest.workers.config.ts` for anything under `src/`). There is no separate lint script.

Always run `npm test` and `npx tsc --noEmit` before considering a change done. This project was built test-first (see below) — new code should follow the same pattern: write the failing test, confirm it fails for the right reason, then implement.

## Architecture

**Fives** is a 2-captain live bidding draft for 5-a-side soccer squads on Cloudflare Workers + Durable Objects + D1. Two captains draft 5 players each from a shared pool of exactly 10, via alternating turn-based bidding. There are no user accounts — captain identity is a bearer token embedded in a join link.

### Two test configs, two runtimes
`vitest.config.ts` (jsdom + `@testing-library/react`) covers `frontend/src/**` and `src/shared/**`. `vitest.workers.config.ts` (`@cloudflare/vitest-pool-workers`) covers everything else under `src/` and runs against **real** D1 and Durable Object bindings from `wrangler.jsonc` — these are integration tests, not mocks. Match new tests to the config that fits what they touch.

### Request routing (`src/index.ts`)
A single Hono app mounts four independent sub-routers: `playersRouter` (`/api/players`), `playersAdminRouter` (`/api/admin/players`, `src/routes/players-admin.ts`), `gamesRouter` (`/api/games`), and `wsRouter` (`/ws/games`) — then falls through to `env.ASSETS.fetch()` for everything else (SPA fallback). Each router is self-contained and testable via `router.request(...)` without booting the full app — add new route groups the same way rather than putting logic directly in `index.ts`.

`Env` bindings: `DB` (D1), `GAME_ROOM` (DO namespace), `ASSETS`, `PLAYER_IMAGES` (R2, roster photos), `CREATE_GAME_RATE_LIMITER` (rate limiting, enforced in `routes/games.ts`'s `POST /`), `THESPORTSDB_API_KEY` (optional, used by `players-admin` for importing player/team data), `APP_BASE_URL`.

### `GameRoom` Durable Object (`src/durable-objects/game-room.ts`) — the authoritative game engine
One instance per game (`idFromName(gameId)`). Game logic lives in plain async methods (`init`, `handleCaptainConnected`, `proposeNextPlayer`, `placeBid`, `pass`, `getState`, `getCaptainForToken`, plus `setCaptainName` and `sendChatMessage`) that return `ActionResult<GameState> = {ok:true,state} | {ok:false,code,message}` instead of throwing. This is a deliberate workaround: throwing custom errors across the DO RPC boundary crashed `vitest-pool-workers`'s isolated-storage bookkeeping, so the return-based pattern must be kept if you touch these methods. They're callable directly (cross-file RPC, or `runInDurableObject`/stub calls in tests) and back the thin WebSocket layer (`fetch`/`webSocketMessage`/`webSocketClose`, using the Hibernation API via `ctx.acceptWebSocket`, with a `ctx.setWebSocketAutoResponse` heartbeat so ping/pong doesn't wake the DO).

State is one JSON blob in the DO's own SQLite storage, written synchronously on every mutation, with every read going back to storage (no in-memory cache) — this is what makes state survive hibernation evictions.

**Load-bearing protocol detail**: every mutating WS handler (`propose_next_player`, `place_bid`, `pass`) broadcasts its specific event (`round_started`, `bid_placed`, `round_settled`, `game_completed`) **and then** a fresh `state_snapshot`. The frontend's `useGameSocket` hook only updates displayed state on `state_snapshot` — it does not hand-parse the granular events. Any new mutating message type must end with a `state_snapshot` broadcast or the UI silently stops updating (this exact bug was caught during integration testing). Auxiliary events (`captain_joined`, `game_started`, `chat_message`, `chat_history`) don't carry game state and aren't subject to this rule.

### Shared contracts (`src/shared/`)
- `constants.ts`: `STARTING_BUDGET` (250,000,000), `MIN_BID_INCREMENT` (5,000,000), `POOL_SIZE` (10), `SQUAD_SIZE` (5), `MIN_GOALIES_IN_POOL` (2), plus text-length caps (`MAX_CAPTAIN_NAME_LENGTH`, `MAX_CHAT_MESSAGE_LENGTH`, `MAX_PLAYER_NAME_LENGTH`, `MAX_LEAGUE_NAME_LENGTH`, `MAX_CLUB_NAME_LENGTH`, `MAX_NATION_NAME_LENGTH`, `MAX_IMAGE_URL_LENGTH`) and roster pagination (`ROSTER_PAGE_SIZE`, `MAX_ROSTER_PAGE_SIZE`).
- `types.ts` / `protocol.ts`: `GameState`, `RoundState`, the full `ClientMessage`/`ServerMessage` discriminated unions — including `join`/`send_chat` and `captain_joined`/`game_started`/`chat_message`/`chat_history`. `Player` also has `league`, `externalId`, `archivedAt`.
- `rules.ts`: `computeReserve`/`computeMaxLegalBid`/`isLegalBid` — a captain can never bid more than `budget - (slots still needed after this player) × minIncrement`. Imported by both the DO (authoritative enforcement) and the frontend (`BidControls`, UX clamping only).
- `sanitize.ts` (`sanitizeText`) / `moderation.ts` (`containsProfanity`): shared input-cleaning for captain names and chat, used by the DO and `players-admin`.

Import from `src/shared/` rather than redefining types locally.

### Game rules encoded in the state machine
Round order is randomized once at game creation (`proposalOrder` on each pool entry). The "first bidder" alternates every round (round 1 is a one-time coin flip stored at creation). The first bidder must place an opening bid — passing is only legal in the `awaiting_response` subphase, which structurally rules out "pass with nothing on the table." A pass settles the round to whoever holds `currentBid`, at that price.

### Game creation (`routes/games.ts`)
`POST /api/games` builds the pool either as a random draw (optionally filtered by `leagues`/`clubs`/`nations`) or from a captain-supplied `selectedPlayerIds` (exactly `POOL_SIZE` unique ids) — both paths enforce `MIN_GOALIES_IN_POOL`. Game ids are two-word slugs from `src/lib/slug.ts`'s `generateGameSlug()` (e.g. `swift-otter`), retried on collision (`MAX_SLUG_ATTEMPTS`) before falling back to a UUID. Creation is rate-limited (`CREATE_GAME_RATE_LIMITER`, 5/min per client IP).

### D1 schema (`src/db/schema.sql`)
`players` (soft-delete via `archived_at` — never hard-delete; historical games must still resolve archived players by id; also has `external_id` unique, `league`, `image_url`), `games`, `game_pool` (one game's 10-player draw + order), `game_players` (final result, written by the DO on completion). `games.published_at`/`public_slug` are unused columns reserved for a not-yet-built "publish results for public voting" feature — leave them alone unless you're building that feature.

### Player images (`routes/players.ts`, R2)
Photos are served from the `PLAYER_IMAGES` R2 bucket at `GET /api/players/images/:key`. `players-admin.ts` covers upload and import (including pulling players/images from TheSportsDB by league/team when `THESPORTSDB_API_KEY` is set).

### Frontend structure
`frontend/src/router.tsx` wires five routes: `/` (home/marketing), `/roster`, `/games/new`, `/game/:gameId/join`, `/game/:gameId`. Captain identity is `frontend/src/lib/session.ts` (localStorage keyed by `gameId`, storing `{token, role, joinUrlForB?, name?}`) — no accounts; `POST /api/games` mints both captain tokens upfront, and the join URL embeds captain B's token as `?t=`.

`frontend/src/hooks/useGameSocket.ts` is the only place that opens/reconnects the game WebSocket. It now reconnects indefinitely with exponential backoff (500ms up to a 10s cap), sends a heartbeat ping every 15s when idle and force-closes on a 5s pong timeout, and resets/re-probes on `visibilitychange` — a fuller rewrite than the original one-shot-retry policy, so don't assume the simpler version still holds.

Styling is real: `frontend/src/styles.css` (~1500 lines, "stadium/matchday" theme) — the app is not unstyled HTML anymore. Beyond the core pages, notable components include `ChatModal.tsx` (+ `lib/chatToggleSlot.ts`) for the chat feature, `AddPlayerModal.tsx`, `Modal.tsx`, `PlayerCard.tsx`, `BidControls.tsx`, `BudgetPanel.tsx`, `ResultsTable.tsx`, `SquadPanel.tsx`, and `lib/api/{games,players}.ts` for typed fetch wrappers.
