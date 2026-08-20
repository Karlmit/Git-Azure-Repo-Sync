import type Database from "better-sqlite3";
import type { LogLevel, SyncLogRow } from "./types";

function rowToLog(row: any): SyncLogRow {
  return {
    id: row.id,
    connectionId: row.connection_id,
    ts: row.ts,
    level: row.level,
    message: row.message,
    details: row.details_json ? JSON.parse(row.details_json) : null,
  };
}

export class SyncLogsRepo {
  constructor(
    private db: Database.Database,
    private maxRowsPerConnection: number = 2000,
    private retentionDays: number = 30,
  ) {}

  insert(connectionId: string, level: LogLevel, message: string, details?: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO sync_logs (connection_id, level, message, details_json) VALUES (?, ?, ?, ?)`,
      )
      .run(connectionId, level, message, details ? JSON.stringify(details) : null);
    this.pruneForConnection(connectionId);
  }

  private pruneForConnection(connectionId: string): void {
    this.db
      .prepare(
        `DELETE FROM sync_logs WHERE connection_id = ? AND id NOT IN (
          SELECT id FROM sync_logs WHERE connection_id = ? ORDER BY id DESC LIMIT ?
        )`,
      )
      .run(connectionId, connectionId, this.maxRowsPerConnection);
  }

  pruneOld(): number {
    const result = this.db
      .prepare(`DELETE FROM sync_logs WHERE ts < datetime('now', ?)`)
      .run(`-${this.retentionDays} days`);
    return result.changes;
  }

  listByConnection(
    connectionId: string,
    opts: { cursor?: number; limit?: number; levels?: LogLevel[] } = {},
  ): { items: SyncLogRow[]; nextCursor: number | null } {
    const limit = opts.limit ?? 50;
    const params: unknown[] = [connectionId];
    let sql = "SELECT * FROM sync_logs WHERE connection_id = ?";
    if (opts.cursor !== undefined) {
      sql += " AND id < ?";
      params.push(opts.cursor);
    }
    if (opts.levels && opts.levels.length > 0) {
      sql += ` AND level IN (${opts.levels.map(() => "?").join(",")})`;
      params.push(...opts.levels);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params).map(rowToLog);
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    return { items: rows, nextCursor };
  }
}
