export const STARTING_BUDGET = 250_000_000;
export const MIN_BID_INCREMENT = 5_000_000;
export const POOL_SIZE = 10;
export const SQUAD_SIZE = 5;
/** Exact number of goalkeepers required in every 10-player pool — not just a minimum, a hard cap too. */
export const GOALIES_IN_POOL = 2;

// ---- Retention ----
/** GameRoom DO state is wiped by its alarm after this long without any activity (refreshed on every mutation). */
export const GAME_DO_TTL_MS = 2 * 24 * 60 * 60 * 1000;
/** Non-completed games (and their game_pool rows) older than this are purged by the daily cleanup cron. Completed games are kept indefinitely. */
export const ABANDONED_GAME_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// ---- Free-text input limits ----
// Enforced server-side (authoritative); frontend inputs mirror these via maxLength
// for instant feedback only.
export const MAX_CAPTAIN_NAME_LENGTH = 40;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const MAX_PLAYER_NAME_LENGTH = 100;
export const MAX_LEAGUE_NAME_LENGTH = 100;
export const MAX_CLUB_NAME_LENGTH = 100;
export const MAX_NATION_NAME_LENGTH = 100;

// ---- Roster pagination ----
export const ROSTER_PAGE_SIZE = 20;
export const MAX_ROSTER_PAGE_SIZE = 200;
export const MAX_IMAGE_URL_LENGTH = 2000;
