import { join } from "node:path";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { registerAuthRoutes } from "./auth/auth.routes";
import { isValidSession, SESSION_COOKIE_NAME } from "./auth/session";
import { registerHealthRoutes } from "./routes/health.routes";
import { registerConnectionsRoutes } from "./routes/connections.routes";
import { registerLogsRoutes } from "./routes/logs.routes";
import { registerConflictsRoutes } from "./routes/conflicts.routes";
import type { ConnectionsRepo } from "./models/connections.repo";
import type { SyncLogsRepo } from "./models/syncLogs.repo";
import type { PendingConflictsRepo } from "./models/pendingConflicts.repo";
import type { Scheduler } from "./scheduler/scheduler";

const PUBLIC_PATHS = new Set(["/api/login", "/api/health", "/api/version"]);

export interface BuildAppOpts {
  connectionsRepo: ConnectionsRepo;
  syncLogsRepo: SyncLogsRepo;
  pendingConflictsRepo: PendingConflictsRepo;
  scheduler: Scheduler;
  mirrorRoot: string;
  encryptionKey: Buffer;
  defaultPollIntervalMinutes: number;
  appUsername: string;
  appPassword: string;
  version: string;
  logLevel: string;
  frontendDistDir?: string;
}

export function buildApp(opts: BuildAppOpts): FastifyInstance {
  const app = Fastify({ logger: { level: opts.logLevel } });

  app.register(fastifyCookie);

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (PUBLIC_PATHS.has(request.url.split("?")[0])) return;
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!isValidSession(token)) {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });

  registerAuthRoutes(app, { username: opts.appUsername, password: opts.appPassword });
  registerHealthRoutes(app, { version: opts.version });
  registerConnectionsRoutes(app, {
    connectionsRepo: opts.connectionsRepo,
    scheduler: opts.scheduler,
    mirrorRoot: opts.mirrorRoot,
    encryptionKey: opts.encryptionKey,
    defaultPollIntervalMinutes: opts.defaultPollIntervalMinutes,
  });
  registerLogsRoutes(app, { syncLogsRepo: opts.syncLogsRepo });
  registerConflictsRoutes(app, { pendingConflictsRepo: opts.pendingConflictsRepo, scheduler: opts.scheduler });

  const distDir = opts.frontendDistDir ?? join(__dirname, "../../frontend/dist");
  if (existsSync(distDir)) {
    app.register(fastifyStatic, { root: distDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html", distDir);
    });
  }

  return app;
}
