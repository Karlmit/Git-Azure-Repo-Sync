CREATE TABLE connections (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  github_url             TEXT NOT NULL,
  azure_org              TEXT NOT NULL,
  azure_project          TEXT NOT NULL,
  azure_repo             TEXT NOT NULL,
  azure_url              TEXT NOT NULL,
  github_pat_ciphertext  BLOB NOT NULL,
  azure_pat_ciphertext   BLOB NOT NULL,
  branch_scope           TEXT NOT NULL DEFAULT 'all',
  branch_list            TEXT,
  sync_tags              INTEGER NOT NULL DEFAULT 1,
  poll_interval_seconds  INTEGER NOT NULL DEFAULT 120,
  enabled                INTEGER NOT NULL DEFAULT 1,
  status                 TEXT NOT NULL DEFAULT 'idle',
  status_detail          TEXT,
  last_synced_at         TEXT,
  last_error_at          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sync_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id  TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ts             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level          TEXT NOT NULL,
  message        TEXT NOT NULL,
  details_json   TEXT
);

CREATE TABLE connection_ref_state (
  connection_id  TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ref_name       TEXT NOT NULL,
  github_sha     TEXT,
  azure_sha      TEXT,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, ref_name)
);
