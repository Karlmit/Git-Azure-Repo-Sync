import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSession, destroySession, SESSION_COOKIE_NAME } from "./session";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: { username: string; password: string },
): Promise<void> {
  app.post("/api/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body" });
    }
    const { username, password } = parsed.data;
    const ok = safeEqual(username, opts.username) && safeEqual(password, opts.password);
    if (!ok) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }
    const token = createSession();
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });
    return reply.send({ ok: true });
  });

  app.post("/api/logout", async (request, reply) => {
    destroySession(request.cookies[SESSION_COOKIE_NAME]);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/api/me", async (request, reply) => {
    return reply.send({ authenticated: true });
  });
}
