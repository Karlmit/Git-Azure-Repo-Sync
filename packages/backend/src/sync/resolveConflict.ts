import { decryptSecret, redactSecrets } from "../crypto/secretBox";
import { buildAuthUrl } from "../git/credentialUrl";
import { runGit } from "../git/exec";
import { mirrorPath } from "../git/mirror";
import type { SyncEngineDeps } from "./engine";

/** "azure" = pull Azure DevOps's version into GitHub. "github" = discard Azure DevOps's version, keep GitHub's (deleting the ref from Azure DevOps if it never existed on GitHub at all). */
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

  const deleteFromAzure = winner === "github" && conflict.githubSha === null;
  const winningSha = winner === "azure" ? conflict.azureSha : conflict.githubSha;

  try {
    if (deleteFromAzure) {
      // GitHub doesn't have this ref at all - "keep GitHub's version" means it
      // shouldn't exist, so remove Azure DevOps's copy.
      await runGit(["push", azureAuthUrl, `:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
    } else {
      const targetUrl = winner === "azure" ? githubAuthUrl : azureAuthUrl;
      await runGit(["push", "--force", targetUrl, `${winningSha}:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
    }
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets);
    deps.syncLogsRepo.insert(connectionId, "error", `Failed to resolve conflict on ${refName}: ${message}`, {
      branch: refName,
    });
    throw new Error(message);
  }

  if (deleteFromAzure) {
    deps.refStateRepo.deleteRef(connectionId, refName);
    deps.syncLogsRepo.insert(
      connectionId,
      "warn",
      `Conflict on ${refName} resolved manually: kept GitHub's absence of this ref, deleted it from Azure DevOps`,
      { branch: refName, winner },
    );
  } else {
    deps.refStateRepo.upsert(connectionId, refName, winningSha, winningSha);
    deps.syncLogsRepo.insert(
      connectionId,
      "warn",
      `Conflict on ${refName} resolved manually: kept the ${winner === "github" ? "GitHub" : "Azure DevOps"} version (${winningSha!.slice(0, 7)})`,
      { branch: refName, winner, winningSha },
    );
  }

  deps.pendingConflictsRepo.deleteRef(connectionId, refName);

  const remaining = deps.pendingConflictsRepo.listByConnection(connectionId);
  if (remaining.length === 0 && conn.status !== "error") {
    deps.connectionsRepo.update(connectionId, { status: "ok", statusDetail: "Conflict resolved." });
  }

  return { winningSha };
}
