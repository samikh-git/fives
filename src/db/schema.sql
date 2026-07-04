CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('GK','DEF','MID','ATT')),
  club TEXT,
  nation TEXT,
  league TEXT,
  image_url TEXT,
  external_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('waiting_for_captain_b','in_progress','completed')) DEFAULT 'waiting_for_captain_b',
  captain_a_token TEXT NOT NULL,
  captain_b_token TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  published_at INTEGER,
  public_slug TEXT UNIQUE
);

CREATE TABLE game_pool (
  game_id TEXT NOT NULL REFERENCES games(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  proposal_order INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE game_players (
  game_id TEXT NOT NULL REFERENCES games(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  captain TEXT NOT NULL CHECK (captain IN ('A','B')),
  price_paid INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
