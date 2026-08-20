import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "./exec";
import { classifyGitError } from "./classify";

export interface TestAccessResult {
  ok: boolean;
  message: string;
}

/**
 * Verifies read+write access to a remote without mutating it: creates a throwaway
 * local repo with one empty commit, then does a `git push --dry-run` of it to a
 * harmless, never-created branch name. A dry-run still goes through the remote's
 * full auth/permission negotiation (which is why a bad or read-only PAT fails here
 * exactly the way it would on a real push), but never transfers or applies anything.
 */
export async function testRemoteAccess(url: string, token: string): Promise<TestAccessResult> {
  const probeDir = mkdtempSync(join(tmpdir(), "gitsync-probe-"));
  try {
    await runGit(["init", "--quiet"], { cwd: probeDir, timeoutMs: 10_000 });
    await runGit(["config", "user.email", "gitsync-probe@local"], { cwd: probeDir, timeoutMs: 5_000 });
    await runGit(["config", "user.name", "gitsync-probe"], { cwd: probeDir, timeoutMs: 5_000 });
    await runGit(["commit", "--allow-empty", "--quiet", "-m", "gitsync connection test"], {
      cwd: probeDir,
      timeoutMs: 5_000,
    });
    await runGit(["push", "--dry-run", url, "HEAD:refs/heads/__gitsync_probe__"], {
      cwd: probeDir,
      timeoutMs: 20_000,
      secrets: [token],
    });
    return { ok: true, message: "Connected - read and write access confirmed." };
  } catch (err) {
    const classified = classifyGitError(err);
    return { ok: false, message: classified.message };
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
