# Fives

A web app for playing **Fives** — a 2-captain live bidding draft for 5-a-side soccer squads.

Two captains each build a 5-player squad by bidding against each other, player by player, from a shared pool of 10 available players, using a fixed budget. Bidding on each player continues until one captain concedes ("lets the other have that player"), at which point that player joins the winning captain's squad at the price they last bid.

## How a game works

1. One captain creates a game by picking exactly **10 players** from the shared roster, with **at least 2 goalkeepers** in that pool. Final squads don't have to include a goalkeeper — the pool just has to guarantee some are available.
2. The creator (Captain A) gets a shareable join link containing Captain B's access token. No accounts or sign-in are required — the link *is* the credential.
3. Once both captains are connected, players are proposed one at a time in a random order fixed at game creation.
4. For each player, one captain is the "first bidder" (this role alternates every round). The first bidder must place an opening bid — they can't concede before any bid exists. After that, captains alternate raising the bid (by at least $5,000,000) or passing. A pass ends the round: the player goes to whoever is currently winning, at that price.
5. Each captain starts with **$250,000,000**. A bid can never exceed what's left after reserving the minimum increment for every squad slot still needed — you can't spend so much on one player that you're unable to afford the rest of your squad.
6. The game ends when both captains have 5 players. Final squads (with prices paid) are shown side by side.

## Getting started

Requires Node.js and npm.

```bash
npm install
npm run db:migrate:local   # apply the D1 schema to a local database
npm run build                # build the frontend into dist/
npm run dev                  # start the app (API + game engine + frontend) on http://localhost:8787
```

Open **http://localhost:8787**, add some players to the roster, then create a game.

For active frontend development with hot reload, also run `cd frontend && npx vite` alongside `npm run dev` — this is a dev-only convenience (Vite proxies `/api` and `/ws` to the Worker); the deployed app is a single Worker serving everything from one origin.

### Tests

```bash
npm test              # everything
npm run test:unit     # frontend + pure shared logic (jsdom)
npm run test:workers  # backend + Durable Object + D1 (real Workers runtime)
npx tsc --noEmit        # typecheck
```

## Tech stack

- **Cloudflare Workers** — HTTP API and static asset hosting (single Worker, single origin)
- **Durable Objects** (SQLite-backed, WebSocket Hibernation API) — one instance per game, holding the authoritative live bidding state
- **D1** — persistent player roster and completed-game records
- **React + Vite**, served as static assets by the Worker
- **Hono** for routing, **Vitest** (+ `@cloudflare/vitest-pool-workers` for real D1/DO integration tests)

See [CLAUDE.md](./CLAUDE.md) / [AGENTS.md](./AGENTS.md) for a deeper architecture walkthrough aimed at coding agents working in this repo.

## Current status / known limitations

- No styling — the UI is currently unstyled semantic HTML. Functional correctness was built first.
- No accounts; captain identity is a bearer token in the join link, stored in the browser's localStorage.
- Roster is a single shared list (no per-group scoping).
- Publishing completed games publicly for third-party voting on "best squad" is a planned future feature — the schema reserves columns for it (`games.published_at`, `games.public_slug`) but it isn't built yet.
