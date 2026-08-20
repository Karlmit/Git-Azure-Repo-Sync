import { readFileSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3012),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DB_PATH: z.string().default("/data/app.db"),
  MIRROR_ROOT: z.string().default("/data/mirrors"),
  DEFAULT_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(120),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  LOG_MAX_ROWS_PER_CONNECTION: z.coerce.number().int().positive().default(2000),
  APP_USERNAME: z.string().min(1, "APP_USERNAME is required"),
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD is required"),
  APP_VERSION: z.string().default("0.0.0-dev"),
});

export type AppEnv = z.infer<typeof envSchema>;

function readEncryptionKey(): Buffer {
  const keyFile = process.env.ENCRYPTION_KEY_FILE;
  const raw = keyFile ? readFileSync(keyFile, "utf8").trim() : process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing encryption key: set ENCRYPTION_KEY_FILE (preferred) or ENCRYPTION_KEY to a base64-encoded 32-byte key.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

let cached: { env: AppEnv; encryptionKey: Buffer } | null = null;

export function loadConfig(): { env: AppEnv; encryptionKey: Buffer } {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const encryptionKey = readEncryptionKey();
  cached = { env: parsed.data, encryptionKey };
  return cached;
}
