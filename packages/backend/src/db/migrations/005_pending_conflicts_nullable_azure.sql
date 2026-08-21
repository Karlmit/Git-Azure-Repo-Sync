-- Derived, ephemeral state - recreating is safe. azure_sha/azure_commit_date can
-- now also be null: an Azure-side deletion of a ref GitHub still has now pauses
-- for approval too, instead of silently being treated as "recreate on Azure".
DROP TABLE pending_conflicts;

CREATE TABLE pending_conflicts (
  connection_id       TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ref_name            TEXT NOT NULL,
  is_tag              INTEGER NOT NULL DEFAULT 0,
  github_sha          TEXT,
  azure_sha           TEXT,
  github_commit_date  TEXT,
  azure_commit_date   TEXT,
  github_summary      TEXT,
  azure_summary       TEXT,
  detected_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, ref_name)
);
