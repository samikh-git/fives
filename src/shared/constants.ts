export const STARTING_BUDGET = 250_000_000;
export const MIN_BID_INCREMENT = 5_000_000;
export const POOL_SIZE = 10;
export const SQUAD_SIZE = 5;
export const MIN_GOALIES_IN_POOL = 2;

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
