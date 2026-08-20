import { loadConfig } from "./config/env";
import { getDb } from "./db/connection";
import { runMigrations } from "./db/migrate";
import { ConnectionsRepo } from "./models/connections.repo";
import { SyncLogsRepo } from "./models/syncLogs.repo";
import { RefStateRepo } from "./models/refState.repo";
import { PendingConflictsRepo } from "./models/pendingConflicts.repo";
import { Scheduler } from "./scheduler/scheduler";
import { buildApp } from "./app";

async function main() {
  const { env, encryptionKey } = loadConfig();

  const db = getDb(env.DB_PATH);
  runMigrations(db);

  const connectionsRepo = new ConnectionsRepo(db, encryptionKey);
  const syncLogsRepo = new SyncLogsRepo(db, env.LOG_MAX_ROWS_PER_CONNECTION, env.LOG_RETENTION_DAYS);
  const refStateRepo = new RefStateRepo(db);
  const pendingConflictsRepo = new PendingConflictsRepo(db);

  const scheduler = new Scheduler({
    connectionsRepo,
    syncLogsRepo,
    refStateRepo,
    pendingConflictsRepo,
    mirrorRoot: env.MIRROR_ROOT,
    encryptionKey,
  });

  const app = buildApp({
    connectionsRepo,
    syncLogsRepo,
    pendingConflictsRepo,
    scheduler,
    mirrorRoot: env.MIRROR_ROOT,
    encryptionKey,
    appUsername: env.APP_USERNAME,
    appPassword: env.APP_PASSWORD,
    version: env.APP_VERSION,
    logLevel: env.LOG_LEVEL,
  });

  scheduler.rescheduleAll(connectionsRepo.listAll());

  setInterval(
    () => syncLogsRepo.pruneOld(),
    24 * 60 * 60 * 1000,
  );

  await app.listen({ port: env.PORT, host: env.HOST });

  const shutdown = async () => {
    scheduler.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
