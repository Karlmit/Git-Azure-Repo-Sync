import { decryptSecret, redactSecrets } from "../crypto/secretBox";
import { buildAuthUrl } from "../git/credentialUrl";
import { runGit } from "../git/exec";
import { mirrorPath } from "../git/mirror";
import type { SyncEngineDeps } from "./engine";

/**
 * "github" = force the *other* side (Azure DevOps) to match GitHub's current state
 * for this ref - creating, updating, or deleting it there as needed.
 * "azure" = force GitHub to match Azure DevOps's current state, symmetrically.
 */
export type ConflictWinner = "github" | "azure";

export class ConflictNotFoundError extends Error {
  constructor() {
    super("No pending conflict found for that ref");
  }
}

export async function resolveConflict(
  deps: SyncEngineDeps,
  connectionId: string,
  refName: string,
  winner: ConflictWinner,
): Promise<{ winningSha: string | null }> {
  const conn = deps.connectionsRepo.getById(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  const conflict = deps.pendingConflictsRepo.get(connectionId, refName);
  if (!conflict) throw new ConflictNotFoundError();

  const githubToken = decryptSecret(conn.githubPatCiphertext, deps.encryptionKey);
  const azureToken = decryptSecret(conn.azurePatCiphertext, deps.encryptionKey);
  const secrets = [githubToken, azureToken];
  const githubAuthUrl = buildAuthUrl(conn.githubUrl, "github", githubToken);
  const azureAuthUrl = buildAuthUrl(conn.azureUrl, "azure", azureToken);
  const mirrorDir = mirrorPath(deps.mirrorRoot, connectionId);
  const refPrefix = conflict.isTag ? "refs/tags" : "refs/heads";
  const shortName = refName.slice(refPrefix.length + 1);

  const winningSha = winner === "github" ? conflict.githubSha : conflict.azureSha;
  const targetUrl = winner === "github" ? azureAuthUrl : githubAuthUrl;

  try {
    if (winningSha === null) {
      // The winning side doesn't have this ref at all - the losing side shouldn't either.
      await runGit(["push", targetUrl, `:${refPrefix}/${shortName}`], { cwd: mirrorDir, timeoutMs: 60_000, secrets });
    } else {
      await runGit(["push", "--force", targetUrl, `${winningSha}:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
    }
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets);
    deps.syncLogsRepo.insert(connectionId, "error", `Failed to resolve ${refName}: ${message}`, { branch: refName });
    throw new Error(message);
  }

  if (winningSha === null) {
    deps.refStateRepo.deleteRef(connectionId, refName);
  } else {
    deps.refStateRepo.upsert(connectionId, refName, winningSha, winningSha);
  }

  const winnerLabel = winner === "github" ? "GitHub" : "Azure DevOps";
  const outcome = winningSha ? `kept the ${winnerLabel} version (${winningSha.slice(0, 7)})` : `${winnerLabel} doesn't have this ref, so it was deleted from the other side`;
  deps.syncLogsRepo.insert(connectionId, "warn", `${refName} resolved manually: ${outcome}`, { branch: refName, winner, winningSha });

  deps.pendingConflictsRepo.deleteRef(connectionId, refName);

  const remaining = deps.pendingConflictsRepo.listByConnection(connectionId);
  if (remaining.length === 0 && conn.status !== "error") {
    deps.connectionsRepo.update(connectionId, { status: "ok", statusDetail: "Conflict resolved." });
  }

  return { winningSha };
}
