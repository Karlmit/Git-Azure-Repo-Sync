import type Database from "better-sqlite3";
import type { RefStateRow } from "./types";

function rowToRefState(row: any): RefStateRow {
  return {
    connectionId: row.connection_id,
    refName: row.ref_name,
    githubSha: row.github_sha,
    azureSha: row.azure_sha,
    updatedAt: row.updated_at,
  };
}

export class RefStateRepo {
  constructor(private db: Database.Database) {}

  listByConnection(connectionId: string): RefStateRow[] {
    return this.db
      .prepare("SELECT * FROM connection_ref_state WHERE connection_id = ?")
      .all(connectionId)
      .map(rowToRefState);
  }

  upsert(connectionId: string, refName: string, githubSha: string | null, azureSha: string | null): void {
    this.db
      .prepare(
        `INSERT INTO connection_ref_state (connection_id, ref_name, github_sha, azure_sha, updated_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(connection_id, ref_name) DO UPDATE SET
           github_sha = excluded.github_sha,
           azure_sha = excluded.azure_sha,
           updated_at = excluded.updated_at`,
      )
      .run(connectionId, refName, githubSha, azureSha);
  }

  deleteRef(connectionId: string, refName: string): void {
    this.db
      .prepare("DELETE FROM connection_ref_state WHERE connection_id = ? AND ref_name = ?")
      .run(connectionId, refName);
  }
}
