import { spawn } from "node:child_process";
import { redactSecrets } from "../crypto/secretBox";

export class GitCommandError extends Error {
  constructor(
    public args: string[],
    public exitCode: number | null,
    public stdout: string,
    public stderr: string,
  ) {
    super(`git ${args[0] ?? ""} failed (exit ${exitCode}): ${stderr || stdout}`);
    this.name = "GitCommandError";
  }
}

export interface RunGitOpts {
  cwd: string;
  timeoutMs?: number;
  secrets?: Array<string | null | undefined>;
}

export function runGit(args: string[], opts: RunGitOpts): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const redact = (s: string) => redactSecrets(s, opts.secrets ?? []);
      const safeOut = redact(stdout);
      const safeErr = redact(stderr) + (timedOut ? "\n(git command timed out and was killed)" : "");
      if (code === 0 && !timedOut) {
        resolve({ stdout: safeOut, stderr: safeErr });
      } else {
        reject(new GitCommandError(args, timedOut ? null : code, safeOut, safeErr));
      }
    });
  });
}
