CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,          -- milliseconds since 1970, as sent by the page
  name TEXT NOT NULL,
  visitor TEXT NOT NULL,        -- random id kept in the visitor's browser, never an account or an IP address
  session TEXT NOT NULL,        -- random id for one browser tab session
  props TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
