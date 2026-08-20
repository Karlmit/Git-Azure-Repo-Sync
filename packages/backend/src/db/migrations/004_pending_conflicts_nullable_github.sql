-- Pending conflicts are derived, ephemeral state (recomputed on every sync), so
-- recreating the table rather than migrating data in place is safe here. github_sha
-- can now be null: a ref that only ever existed on Azure DevOps has no GitHub side
-- yet.
DROP TABLE pending_conflicts;

CREATE TABLE pending_conflicts (
  connection_id       TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  ref_name            TEXT NOT NULL,
  is_tag              INTEGER NOT NULL DEFAULT 0,
  github_sha          TEXT,
  azure_sha           TEXT NOT NULL,
  github_commit_date  TEXT,
  azure_commit_date   TEXT NOT NULL,
  github_summary      TEXT,
  azure_summary       TEXT,
  detected_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, ref_name)
);
