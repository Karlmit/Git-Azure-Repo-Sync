import { runGit, GitCommandError } from "./exec";

export async function listRefs(mirrorDir: string, refPrefix: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let stdout: string;
  try {
    ({ stdout } = await runGit(["for-each-ref", "--format=%(refname) %(objectname)", refPrefix], {
      cwd: mirrorDir,
      timeoutMs: 30_000,
    }));
  } catch (err) {
    if (err instanceof GitCommandError) return map;
    throw err;
  }
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [refname, sha] = trimmed.split(" ");
    const name = refname.slice(refPrefix.length + (refPrefix.endsWith("/") ? 0 : 1));
    map.set(name, sha);
  }
  return map;
}

export async function isAncestor(mirrorDir: string, ancestorSha: string, descendantSha: string): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", ancestorSha, descendantSha], {
      cwd: mirrorDir,
      timeoutMs: 30_000,
    });
    return true;
  } catch (err) {
    if (err instanceof GitCommandError && err.exitCode === 1) return false;
    throw err;
  }
}

export async function commitDate(mirrorDir: string, sha: string): Promise<string> {
  const { stdout } = await runGit(["log", "-1", "--format=%cI", sha], { cwd: mirrorDir, timeoutMs: 30_000 });
  return stdout.trim();
}
