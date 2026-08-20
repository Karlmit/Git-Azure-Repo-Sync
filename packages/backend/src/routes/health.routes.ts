import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance, opts: { version: string }): Promise<void> {
  const startedAt = Date.now();

  app.get("/api/health", async () => ({
    status: "ok",
    version: opts.version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.get("/api/version", async () => ({ version: opts.version }));
}
