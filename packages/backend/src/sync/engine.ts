import { decryptSecret, redactSecrets } from "../crypto/secretBox";
import { buildAuthUrl } from "../git/credentialUrl";
import { classifyGitError } from "../git/classify";
import { runGit } from "../git/exec";
import { ensureMirrorExists, mirrorPath } from "../git/mirror";
import { commitDate, commitSummary, isAncestor, listRefs } from "../git/refs";
import type { ConnectionsRepo } from "../models/connections.repo";
import type { SyncLogsRepo } from "../models/syncLogs.repo";
import type { RefStateRepo } from "../models/refState.repo";
import type { PendingConflictsRepo } from "../models/pendingConflicts.repo";
import { decideRef } from "./branchPlan";
import type { PlanItem, SyncPlan, SyncResult } from "./types";
import { sendWebhookNotification } from "../notify/webhook";
import { formatPauseNotification, type NewlyPausedRef } from "../notify/formatPauseNotification";

export interface SyncEngineDeps {
  connectionsRepo: ConnectionsRepo;
  syncLogsRepo: SyncLogsRepo;
  refStateRepo: RefStateRepo;
  pendingConflictsRepo: PendingConflictsRepo;
  mirrorRoot: string;
  encryptionKey: Buffer;
  /** Optional. When set, an HTTP POST fires here whenever a ref newly needs approval. */
  notifyWebhookUrl?: string;
  /** Optional. Where this instance is reachable from - used to link back to the app from notifications. */
  appBaseUrl?: string;
}

export interface Urls {
  githubAuthUrl: string;
  azureAuthUrl: string;
  githubToken: string;
  azureToken: string;
}

function refPrefixFor(isTag: boolean): string {
  return isTag ? "refs/tags" : "refs/heads";
}

async function buildPlanForKind(
  mirrorDir: string,
  isTag: boolean,
  githubRefs: Map<string, string>,
  azureRefs: Map<string, string>,
  branchFilter: (name: string) => boolean,
  previouslySeenRefs: Set<string>,
): Promise<PlanItem[]> {
  const names = new Set<string>();
  for (const name of githubRefs.keys()) if (branchFilter(name)) names.add(name);
  for (const name of azureRefs.keys()) if (branchFilter(name)) names.add(name);

  const items: PlanItem[] = [];
  for (const name of names) {
    const fullRefName = `${refPrefixFor(isTag)}/${name}`;
    const githubSha = githubRefs.get(name) ?? null;
    const azureSha = azureRefs.get(name) ?? null;

    let azureIsAncestorOfGithub = false;
    let githubCommitDate: string | null = null;
    let azureCommitDate: string | null = null;

    const previouslySeen = previouslySeenRefs.has(fullRefName);

    if (githubSha && azureSha && githubSha !== azureSha) {
      azureIsAncestorOfGithub = await isAncestor(mirrorDir, azureSha, githubSha);
      if (!azureIsAncestorOfGithub) {
        // Azure has content GitHub doesn't (strictly ahead or truly diverged) -
        // this will pause, so fetch dates for the GUI to show.
        [githubCommitDate, azureCommitDate] = await Promise.all([
          commitDate(mirrorDir, githubSha),
          commitDate(mirrorDir, azureSha),
        ]);
      }
    } else if (azureSha && !githubSha && !previouslySeen) {
      // Brand-new Azure-only ref - pauses, so fetch its date too.
      azureCommitDate = await commitDate(mirrorDir, azureSha);
    } else if (githubSha && !azureSha && previouslySeen) {
      // Azure DevOps deleted a ref GitHub still has - pauses, so fetch its date too.
      githubCommitDate = await commitDate(mirrorDir, githubSha);
    }

    const decision = decideRef({
      refName: fullRefName,
      githubSha,
      azureSha,
      githubCommitDate,
      azureCommitDate,
      azureIsAncestorOfGithub,
      previouslySeen,
    });

    items.push({ refName: fullRefName, isTag, decision, observedGithubSha: githubSha, observedAzureSha: azureSha });
  }
  return items;
}

async function applyDecision(mirrorDir: string, item: PlanItem, urls: Urls): Promise<void> {
  const { decision, isTag, refName } = item;
  const shortName = refName.slice(refPrefixFor(isTag).length + 1);
  const refPrefix = refPrefixFor(isTag);
  const secrets = [urls.githubToken, urls.azureToken];

  switch (decision.kind) {
    case "noop":
      return;

    case "push-to-azure": {
      await runGit(["push", urls.azureAuthUrl, `${decision.toSha}:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
      return;
    }

    case "delete-on-azure": {
      await runGit(["push", urls.azureAuthUrl, `:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
      return;
    }

    case "needs-approval":
      // Never auto-applied - handled separately in the main loop by recording a
      // pending conflict instead of pushing anything.
      return;
  }
}

function summarizePlan(plan: SyncPlan): string {
  const applied = plan.filter((p) => p.decision.kind !== "noop");
  if (applied.length === 0) return "Up to date, no changes.";
  const parts = applied.map((p) => `${p.refName}: ${p.decision.kind}`);
  return parts.join("; ");
}

export async function runSyncForConnection(deps: SyncEngineDeps, connectionId: string): Promise<SyncResult> {
  const conn = deps.connectionsRepo.getById(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  const mirrorDir = mirrorPath(deps.mirrorRoot, connectionId);
  let secrets: string[] = [];

  deps.connectionsRepo.update(connectionId, { status: "syncing" });
  deps.syncLogsRepo.insert(connectionId, "info", "Sync started");

  try {
    const githubToken = decryptSecret(conn.githubPatCiphertext, deps.encryptionKey);
    const azureToken = decryptSecret(conn.azurePatCiphertext, deps.encryptionKey);
    const urls: Urls = {
      githubAuthUrl: buildAuthUrl(conn.githubUrl, "github", githubToken),
      azureAuthUrl: buildAuthUrl(conn.azureUrl, "azure", azureToken),
      githubToken,
      azureToken,
    };
    secrets = [githubToken, azureToken];

    await ensureMirrorExists(mirrorDir, urls.githubAuthUrl, secrets);

    await runGit(
      ["fetch", "--prune", urls.githubAuthUrl, "+refs/heads/*:refs/remotes/github/*", "+refs/tags/*:refs/remotes/github-tags/*"],
      { cwd: mirrorDir, timeoutMs: 120_000, secrets },
    );
    await runGit(
      ["fetch", "--prune", urls.azureAuthUrl, "+refs/heads/*:refs/remotes/azure/*", "+refs/tags/*:refs/remotes/azure-tags/*"],
      { cwd: mirrorDir, timeoutMs: 120_000, secrets },
    );

    const [githubBranches, azureBranches, githubTags, azureTags] = await Promise.all([
      listRefs(mirrorDir, "refs/remotes/github"),
      listRefs(mirrorDir, "refs/remotes/azure"),
      listRefs(mirrorDir, "refs/remotes/github-tags"),
      listRefs(mirrorDir, "refs/remotes/azure-tags"),
    ]);

    const previouslySeen = new Set(deps.refStateRepo.listByConnection(connectionId).map((r) => r.refName));

    const branchFilter =
      conn.branchScope === "explicit" ? (name: string) => conn.branchList.includes(name) : () => true;

    const branchPlan = await buildPlanForKind(
      mirrorDir,
      false,
      githubBranches,
      azureBranches,
      branchFilter,
      previouslySeen,
    );

    let tagPlan: PlanItem[] = [];
    if (conn.syncTags) {
      tagPlan = await buildPlanForKind(mirrorDir, true, githubTags, azureTags, () => true, previouslySeen);
    }

    const plan: SyncPlan = [...branchPlan, ...tagPlan];

    let hadBranchError = false;
    let hadManualConflict = false;
    const currentConflictRefs = new Set<string>();
    const newlyPaused: NewlyPausedRef[] = [];

    for (const item of plan) {
      if (item.decision.kind === "noop") {
        // Both sides already agree - still record it so a later one-sided deletion
        // of this exact ref is recognized as a delete rather than a first-ever create.
        deps.refStateRepo.upsert(connectionId, item.refName, item.observedGithubSha, item.observedAzureSha);
        continue;
      }

      if (item.decision.kind === "needs-approval") {
        currentConflictRefs.add(item.refName);
        hadManualConflict = true;
        const wasAlreadyPending = deps.pendingConflictsRepo.get(connectionId, item.refName) !== null;
        const { githubSha, azureSha, githubCommitDate, azureCommitDate } = item.decision;
        const [githubSummary, azureSummary] = await Promise.all([
          githubSha ? commitSummary(mirrorDir, githubSha) : Promise.resolve(null),
          azureSha ? commitSummary(mirrorDir, azureSha) : Promise.resolve(null),
        ]);
        deps.pendingConflictsRepo.upsert(connectionId, {
          refName: item.refName,
          isTag: item.isTag,
          githubSha,
          azureSha,
          githubCommitDate,
          azureCommitDate,
          githubSummary,
          azureSummary,
        });
        if (!wasAlreadyPending) {
          newlyPaused.push({
            refName: item.refName,
            isTag: item.isTag,
            githubSha,
            azureSha,
            githubCommitDate,
            azureCommitDate,
            githubSummary,
            azureSummary,
          });
        }
        const githubLabel = githubSha ? `${githubSha.slice(0, 7)}, ${githubCommitDate}` : "does not exist";
        const azureLabel = azureSha ? `${azureSha.slice(0, 7)}, ${azureCommitDate}` : "was deleted";
        deps.syncLogsRepo.insert(
          connectionId,
          "warn",
          `Needs approval on ${item.refName} (GitHub: ${githubLabel}; Azure DevOps: ${azureLabel}) - resolve from the GUI`,
          { branch: item.refName, githubSha, azureSha, githubCommitDate, azureCommitDate },
        );
        continue;
      }

      try {
        await applyDecision(mirrorDir, item, urls);

        if (item.decision.kind === "delete-on-azure") {
          deps.refStateRepo.deleteRef(connectionId, item.refName);
        } else {
          deps.refStateRepo.upsert(connectionId, item.refName, item.decision.toSha, item.decision.toSha);
        }

        deps.syncLogsRepo.insert(connectionId, "info", `${item.decision.kind} applied to ${item.refName}`, {
          branch: item.refName,
        });
      } catch (err) {
        const classified = classifyGitError(err);
        const message = redactSecrets(classified.message, secrets);
        if (classified.kind === "race") {
          deps.syncLogsRepo.insert(
            connectionId,
            "warn",
            `Remote moved between fetch and push for ${item.refName}, will retry next cycle: ${message}`,
          );
        } else {
          hadBranchError = true;
          deps.syncLogsRepo.insert(connectionId, "error", `Failed to sync ${item.refName}: ${message}`, {
            branch: item.refName,
          });
        }
      }
    }

    // Conflicts that no longer reproduce this run (e.g. one side fast-forwarded
    // onto the other since the last poll) have resolved themselves - drop them.
    deps.pendingConflictsRepo.pruneStale(connectionId, currentConflictRefs);

    const status = hadBranchError ? "error" : hadManualConflict ? "conflict" : "ok";
    deps.connectionsRepo.update(connectionId, {
      status,
      statusDetail: summarizePlan(plan),
      lastSyncedAt: new Date().toISOString(),
    });
    deps.syncLogsRepo.insert(connectionId, "info", "Sync completed", { status });

    if (newlyPaused.length > 0 && deps.notifyWebhookUrl) {
      try {
        const html = formatPauseNotification(
          conn.name,
          newlyPaused,
          deps.appBaseUrl ? { baseUrl: deps.appBaseUrl, connectionId } : undefined,
        );
        await sendWebhookNotification(deps.notifyWebhookUrl, html);
      } catch (notifyErr) {
        deps.syncLogsRepo.insert(
          connectionId,
          "warn",
          `Failed to send pause notification: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`,
        );
      }
    }

    return { connectionId, status, plan };
  } catch (err) {
    const classified = classifyGitError(err);
    const message = redactSecrets(classified.message, secrets);
    const detail =
      classified.kind === "auth"
        ? `Authentication failed — check PAT validity/expiry/scopes: ${message}`
        : classified.kind === "network"
          ? `Network error reaching a remote: ${message}`
          : message;

    deps.connectionsRepo.update(connectionId, {
      status: "error",
      statusDetail: detail,
      lastErrorAt: new Date().toISOString(),
    });
    deps.syncLogsRepo.insert(connectionId, "error", `Sync failed: ${detail}`);

    return { connectionId, status: "error", plan: [], error: detail };
  }
}
