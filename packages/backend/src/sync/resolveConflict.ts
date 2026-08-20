import { decryptSecret, redactSecrets } from "../crypto/secretBox";
import { buildAuthUrl } from "../git/credentialUrl";
import { runGit } from "../git/exec";
import { mirrorPath } from "../git/mirror";
import type { SyncEngineDeps } from "./engine";

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
): Promise<{ winningSha: string }> {
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

  const winningSha = winner === "github" ? conflict.githubSha : conflict.azureSha;
  const targetUrl = winner === "github" ? azureAuthUrl : githubAuthUrl; // push the winner onto the *other* (losing) side
  const refPrefix = conflict.isTag ? "refs/tags" : "refs/heads";
  const shortName = refName.slice(refPrefix.length + 1);

  try {
    await runGit(["push", "--force", targetUrl, `${winningSha}:${refPrefix}/${shortName}`], {
      cwd: mirrorDir,
      timeoutMs: 60_000,
      secrets,
    });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets);
    deps.syncLogsRepo.insert(connectionId, "error", `Failed to resolve conflict on ${refName}: ${message}`, {
      branch: refName,
    });
    throw new Error(message);
  }

  deps.refStateRepo.upsert(connectionId, refName, winningSha, winningSha);
  deps.pendingConflictsRepo.deleteRef(connectionId, refName);
  deps.syncLogsRepo.insert(
    connectionId,
    "warn",
    `Conflict on ${refName} resolved manually: kept the ${winner === "github" ? "GitHub" : "Azure DevOps"} version (${winningSha.slice(0, 7)})`,
    { branch: refName, winner, winningSha },
  );

  const remaining = deps.pendingConflictsRepo.listByConnection(connectionId);
  if (remaining.length === 0 && conn.status !== "error") {
    deps.connectionsRepo.update(connectionId, { status: "ok", statusDetail: "Conflict resolved." });
  }

  return { winningSha };
}
