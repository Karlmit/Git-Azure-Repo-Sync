import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PendingConflictsRepo } from "../models/pendingConflicts.repo";
import type { Scheduler } from "../scheduler/scheduler";
import { ConflictNotFoundError } from "../sync/resolveConflict";

const resolveSchema = z.object({
  refName: z.string().min(1),
  winner: z.enum(["github", "azure"]),
});

export async function registerConflictsRoutes(
  app: FastifyInstance,
  deps: { pendingConflictsRepo: PendingConflictsRepo; scheduler: Scheduler },
): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/connections/:id/conflicts", async (request) => {
    return deps.pendingConflictsRepo.listByConnection(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/conflicts/resolve", async (request, reply) => {
    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues });
    }
    try {
      const result = await deps.scheduler.resolveConflict(
        request.params.id,
        parsed.data.refName,
        parsed.data.winner,
      );
      return result;
    } catch (err) {
      if (err instanceof ConflictNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(409).send({ error: err instanceof Error ? err.message : "Failed to resolve conflict" });
    }
  });
}
