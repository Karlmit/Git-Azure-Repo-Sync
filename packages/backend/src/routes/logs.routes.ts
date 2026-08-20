import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SyncLogsRepo } from "../models/syncLogs.repo";
import type { LogLevel } from "../models/types";

const querySchema = z.object({
  cursor: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  level: z.string().optional(),
});

export async function registerLogsRoutes(app: FastifyInstance, deps: { syncLogsRepo: SyncLogsRepo }): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/connections/:id/logs", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }
    const levels = parsed.data.level
      ? (parsed.data.level.split(",").filter(Boolean) as LogLevel[])
      : undefined;
    return deps.syncLogsRepo.listByConnection(request.params.id, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      levels,
    });
  });
}
