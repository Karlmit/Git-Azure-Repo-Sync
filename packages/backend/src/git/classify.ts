import { GitCommandError } from "./exec";

export type FailureKind = "auth" | "network" | "race" | "other";

const AUTH_PATTERN = /(authentication failed|401|403|access denied|tf401019|permission to .* denied)/i;
const NETWORK_PATTERN = /(could not resolve host|connection timed out|network is unreachable|empty reply|could not connect|timed out and was killed)/i;
const RACE_PATTERN = /(non-fast-forward|stale info|fetch first|already exists)/i;

export function classifyGitError(err: unknown): { kind: FailureKind; message: string } {
  const text = err instanceof GitCommandError ? `${err.stderr}\n${err.stdout}` : String((err as Error)?.message ?? err);

  if (AUTH_PATTERN.test(text)) {
    return { kind: "auth", message: text.trim() || "Authentication failed" };
  }
  if (NETWORK_PATTERN.test(text)) {
    return { kind: "network", message: text.trim() || "Network error" };
  }
  if (RACE_PATTERN.test(text)) {
    return { kind: "race", message: text.trim() || "Remote moved between fetch and push" };
  }
  return { kind: "other", message: text.trim() || String(err) };
}
