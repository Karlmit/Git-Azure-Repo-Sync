import type Database from "better-sqlite3";
import type { PendingConflictRow } from "./types";

function rowToConflict(row: any): PendingConflictRow {
  return {
    connectionId: row.connection_id,
    refName: row.ref_name,
    isTag: !!row.is_tag,
    githubSha: row.github_sha,
    azureSha: row.azure_sha,
    githubCommitDate: row.github_commit_date,
    azureCommitDate: row.azure_commit_date,
    githubSummary: row.github_summary,
    azureSummary: row.azure_summary,
    detectedAt: row.detected_at,
  };
}

export type NewPendingConflict = Omit<PendingConflictRow, "connectionId" | "detectedAt">;

export class PendingConflictsRepo {
  constructor(private db: Database.Database) {}

  listByConnection(connectionId: string): PendingConflictRow[] {
    return this.db
      .prepare("SELECT * FROM pending_conflicts WHERE connection_id = ? ORDER BY ref_name ASC")
      .all(connectionId)
      .map(rowToConflict);
  }

  get(connectionId: string, refName: string): PendingConflictRow | null {
    const row = this.db
      .prepare("SELECT * FROM pending_conflicts WHERE connection_id = ? AND ref_name = ?")
      .get(connectionId, refName);
    return row ? rowToConflict(row) : null;
  }

  upsert(connectionId: string, conflict: NewPendingConflict): void {
    this.db
      .prepare(
        `INSERT INTO pending_conflicts (
          connection_id, ref_name, is_tag, github_sha, azure_sha,
          github_commit_date, azure_commit_date, github_summary, azure_summary
        ) VALUES (@connectionId, @refName, @isTag, @githubSha, @azureSha, @githubCommitDate, @azureCommitDate, @githubSummary, @azureSummary)
        ON CONFLICT(connection_id, ref_name) DO UPDATE SET
          github_sha = excluded.github_sha,
          azure_sha = excluded.azure_sha,
          github_commit_date = excluded.github_commit_date,
          azure_commit_date = excluded.azure_commit_date,
          github_summary = excluded.github_summary,
          azure_summary = excluded.azure_summary`,
      )
      .run({
        connectionId,
        refName: conflict.refName,
        isTag: conflict.isTag ? 1 : 0,
        githubSha: conflict.githubSha,
        azureSha: conflict.azureSha,
        githubCommitDate: conflict.githubCommitDate,
        azureCommitDate: conflict.azureCommitDate,
        githubSummary: conflict.githubSummary,
        azureSummary: conflict.azureSummary,
      });
  }

  deleteRef(connectionId: string, refName: string): void {
    this.db
      .prepare("DELETE FROM pending_conflicts WHERE connection_id = ? AND ref_name = ?")
      .run(connectionId, refName);
  }

  /** Removes any pending conflict for this connection whose ref is no longer in `currentRefNames` - i.e. it resolved itself since the last sync. */
  pruneStale(connectionId: string, currentRefNames: Set<string>): void {
    for (const row of this.listByConnection(connectionId)) {
      if (!currentRefNames.has(row.refName)) {
        this.deleteRef(connectionId, row.refName);
      }
    }
  }
}
