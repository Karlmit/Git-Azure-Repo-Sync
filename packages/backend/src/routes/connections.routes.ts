import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { decryptSecret } from "../crypto/secretBox";
import { buildAuthUrl } from "../git/credentialUrl";
import { purgeMirror } from "../git/mirror";
import { testRemoteAccess } from "../git/testAccess";
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

const testNewSchema = z.object({
  githubUrl: z.string().url(),
  githubPat: z.string().min(1),
  azureOrg: z.string().min(1),
  azureProject: z.string().min(1),
  azureRepo: z.string().min(1),
  azurePat: z.string().min(1),
});

const testExistingSchema = z.object({
  githubPat: z.string().min(1).optional(),
  azurePat: z.string().min(1).optional(),
});

export async function registerConnectionsRoutes(
  app: FastifyInstance,
  deps: { connectionsRepo: ConnectionsRepo; scheduler: Scheduler; mirrorRoot: string; encryptionKey: Buffer },
): Promise<void> {
  const { connectionsRepo, scheduler, mirrorRoot, encryptionKey } = deps;

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

  // Registered before "/:id" style routes matter only for readability here - Fastify's
  // router already prefers this static "test" segment over the ":id" param route.
  app.post("/api/connections/test", async (request, reply) => {
    const parsed = testNewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }
    const { githubUrl, githubPat, azureOrg, azureProject, azureRepo, azurePat } = parsed.data;
    const azureUrl = `https://dev.azure.com/${encodeURIComponent(azureOrg)}/${encodeURIComponent(azureProject)}/_git/${encodeURIComponent(azureRepo)}`;
    const [github, azure] = await Promise.all([
      testRemoteAccess(buildAuthUrl(githubUrl, "github", githubPat), githubPat),
      testRemoteAccess(buildAuthUrl(azureUrl, "azure", azurePat), azurePat),
    ]);
    return { github, azure };
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (request, reply) => {
    const conn = connectionsRepo.getById(request.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    const parsed = testExistingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }
    const githubPat = parsed.data.githubPat ?? decryptSecret(conn.githubPatCiphertext, encryptionKey);
    const azurePat = parsed.data.azurePat ?? decryptSecret(conn.azurePatCiphertext, encryptionKey);
    const [github, azure] = await Promise.all([
      testRemoteAccess(buildAuthUrl(conn.githubUrl, "github", githubPat), githubPat),
      testRemoteAccess(buildAuthUrl(conn.azureUrl, "azure", azurePat), azurePat),
    ]);
    return { github, azure };
  });
}
