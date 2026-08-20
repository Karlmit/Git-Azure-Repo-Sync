import type { Connection } from "../models/types";
import type { SyncEngineDeps } from "../sync/engine";
import { runSyncForConnection } from "../sync/engine";
import { resolveConflict, type ConflictWinner } from "../sync/resolveConflict";
import type { SyncResult } from "../sync/types";

export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Map<string, Promise<SyncResult>>();
  private resolving = new Set<string>();

  constructor(private deps: SyncEngineDeps) {}

  async triggerSync(connectionId: string): Promise<SyncResult> {
    const existing = this.running.get(connectionId);
    if (existing) return existing;
    if (this.resolving.has(connectionId)) {
      throw new Error("A conflict resolution is currently in progress for this connection - try again in a moment.");
    }

    const runPromise = runSyncForConnection(this.deps, connectionId).finally(() => {
      this.running.delete(connectionId);
    });
    this.running.set(connectionId, runPromise);
    return runPromise;
  }

  async resolveConflict(
    connectionId: string,
    refName: string,
    winner: ConflictWinner,
  ): Promise<{ winningSha: string | null }> {
    if (this.running.has(connectionId)) {
      throw new Error("A sync is currently in progress for this connection - try again in a moment.");
    }
    if (this.resolving.has(connectionId)) {
      throw new Error("Another conflict resolution is already in progress for this connection.");
    }

    this.resolving.add(connectionId);
    try {
      return await resolveConflict(this.deps, connectionId, refName, winner);
    } finally {
      this.resolving.delete(connectionId);
    }
  }

  scheduleConnection(conn: Connection): void {
    this.unscheduleConnection(conn.id);
    if (!conn.enabled) return;
    const intervalMs = conn.pollIntervalSeconds * 1000;
    const timer = setInterval(() => {
      this.triggerSync(conn.id).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`Unhandled scheduler error for connection ${conn.id}:`, err);
      });
    }, intervalMs);
    this.timers.set(conn.id, timer);
  }

  unscheduleConnection(connectionId: string): void {
    const timer = this.timers.get(connectionId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(connectionId);
    }
  }

  rescheduleAll(connections: Connection[]): void {
    for (const conn of connections) this.scheduleConnection(conn);
  }

  isRunning(connectionId: string): boolean {
    return this.running.has(connectionId);
  }

  shutdown(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}
