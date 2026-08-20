import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { purgeMirror } from "../git/mirror";
import { ConnectionsRepo, toPublic } from "../models/connections.repo";
import type { Scheduler } from "../scheduler/scheduler";

const createSchema = z.object({
  name: z.string().min(1),
  githubUrl: z.string().url(),
  azureOrg: z.string().min(1),
  azureProject: z.string().min(1),
  azureRepo: z.string().min(1),
  githubPat: z.string().min(1),
  azurePat: z.string().min(1),
  branchScope: z.enum(["all", "explicit"]).default("all"),
  branchList: z.array(z.string()).default([]),
  syncTags: z.boolean().default(true),
  pollIntervalSeconds: z.coerce.number().int().min(30).default(120),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  githubUrl: z.string().url().optional(),
  azureOrg: z.string().min(1).optional(),
  azureProject: z.string().min(1).optional(),
  azureRepo: z.string().min(1).optional(),
  githubPat: z.string().min(1).optional(),
  azurePat: z.string().min(1).optional(),
  branchScope: z.enum(["all", "explicit"]).optional(),
  branchList: z.array(z.string()).optional(),
  syncTags: z.boolean().optional(),
  pollIntervalSeconds: z.coerce.number().int().min(30).optional(),
  enabled: z.boolean().optional(),
});

export async function registerConnectionsRoutes(
  app: FastifyInstance,
  deps: { connectionsRepo: ConnectionsRepo; scheduler: Scheduler; mirrorRoot: string },
): Promise<void> {
  const { connectionsRepo, scheduler, mirrorRoot } = deps;

  app.get("/api/connections", async () => {
    return connectionsRepo.listAll().map(toPublic);
  });

  app.post("/api/connections", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }
    const conn = connectionsRepo.create(parsed.data);
    scheduler.scheduleConnection(conn);
    return reply.status(201).send(toPublic(conn));
  });

  app.get<{ Params: { id: string } }>("/api/connections/:id", async (request, reply) => {
    const conn = connectionsRepo.getById(request.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    return toPublic(conn);
  });

  app.patch<{ Params: { id: string } }>("/api/connections/:id", async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }
    const updated = connectionsRepo.update(request.params.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "Connection not found" });
    scheduler.scheduleConnection(updated);
    return toPublic(updated);
  });

  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (request, reply) => {
    const conn = connectionsRepo.getById(request.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    scheduler.unscheduleConnection(conn.id);
    connectionsRepo.delete(conn.id);
    purgeMirror(mirrorRoot, conn.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/pause", async (request, reply) => {
    const updated = connectionsRepo.update(request.params.id, { enabled: false });
    if (!updated) return reply.status(404).send({ error: "Connection not found" });
    scheduler.unscheduleConnection(updated.id);
    return toPublic(updated);
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/resume", async (request, reply) => {
    const updated = connectionsRepo.update(request.params.id, { enabled: true });
    if (!updated) return reply.status(404).send({ error: "Connection not found" });
    scheduler.scheduleConnection(updated);
    return toPublic(updated);
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/sync-now", async (request, reply) => {
    const conn = connectionsRepo.getById(request.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    const result = await scheduler.triggerSync(conn.id);
    return result;
  });
}
