import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "./exec";

export function mirrorPath(mirrorRoot: string, connectionId: string): string {
  return join(mirrorRoot, connectionId, "mirror.git");
}

export async function ensureMirrorExists(mirrorDir: string, initialCloneUrl: string, secrets: string[]): Promise<void> {
  if (existsSync(join(mirrorDir, "HEAD"))) return;
  mkdirSync(mirrorDir, { recursive: true });
  await runGit(["clone", "--bare", "--mirror", initialCloneUrl, mirrorDir], {
    cwd: mirrorDir,
    timeoutMs: 120_000,
    secrets,
  });
}

export function purgeMirror(mirrorRoot: string, connectionId: string): void {
  const dir = join(mirrorRoot, connectionId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
