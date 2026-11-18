-- Append-only observations. Current state is computed when read.
CREATE TABLE IF NOT EXISTS observations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  vin TEXT NOT NULL,
  job TEXT NOT NULL,
  run TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX IF NOT EXISTS observations_vin ON observations (vin, observed_at DESC, seq DESC);
