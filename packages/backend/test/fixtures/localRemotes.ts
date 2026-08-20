import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeBareRepo(): string {
  const dir = makeTempDir("gitsync-bare-");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", dir]);
  return dir;
}

export function makeWorkTree(): string {
  const dir = makeTempDir("gitsync-work-");
  execFileSync("git", ["init", "--initial-branch=main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
  return dir;
}

let counter = 0;

export function commitFile(workDir: string, content: string, isoDate?: string): string {
  counter += 1;
  writeFileSync(join(workDir, `file-${counter}.txt`), content);
  execFileSync("git", ["-C", workDir, "add", "."]);
  const env = isoDate ? { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } : process.env;
  execFileSync("git", ["-C", workDir, "commit", "-m", `commit ${counter}`], { env });
  return execFileSync("git", ["-C", workDir, "rev-parse", "HEAD"]).toString().trim();
}

export function push(workDir: string, destDir: string, refspec = "main"): void {
  execFileSync("git", ["-C", workDir, "push", "-f", destDir, refspec]);
}

export function resetHard(workDir: string, sha: string): void {
  execFileSync("git", ["-C", workDir, "reset", "--hard", sha]);
}

export function tagAt(workDir: string, name: string, sha: string): void {
  execFileSync("git", ["-C", workDir, "tag", "-f", name, sha]);
}

export function fileUrl(dir: string): string {
  return `file://${dir}`;
}
