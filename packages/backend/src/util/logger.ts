import pino from "pino";

export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: ["*.password", "*.githubPat", "*.azurePat", "*.token", "req.headers.cookie"],
      censor: "***REDACTED***",
    },
  });
}
