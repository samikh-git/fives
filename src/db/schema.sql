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
  public_slug TEXT UNIQUE,
  voting_closes_at INTEGER,
  captain_a_notify_email TEXT,
  captain_b_notify_email TEXT,
  voting_closed_notified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_games_created_at ON games (created_at);

CREATE TABLE game_votes (
  game_id TEXT NOT NULL REFERENCES games(id),
  voter_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('A','B')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, voter_id)
);

CREATE TABLE game_comments (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  author_name TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_comments_game_id ON game_comments (game_id, created_at);

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
