ALTER TABLE games ADD COLUMN voting_closes_at INTEGER;
ALTER TABLE games ADD COLUMN captain_a_notify_email TEXT;
ALTER TABLE games ADD COLUMN captain_b_notify_email TEXT;
ALTER TABLE games ADD COLUMN voting_closed_notified_at INTEGER;

CREATE TABLE game_votes (
  game_id TEXT NOT NULL REFERENCES games(id),
  voter_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('A','B')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, voter_id)
);
