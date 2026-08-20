import { decryptSecret, redactSecrets } from "../crypto/secretBox";
import { buildAuthUrl } from "../git/credentialUrl";
import { classifyGitError } from "../git/classify";
import { runGit } from "../git/exec";
import { ensureMirrorExists, mirrorPath } from "../git/mirror";
import { commitDate, isAncestor, listRefs } from "../git/refs";
import type { ConnectionsRepo } from "../models/connections.repo";
import type { SyncLogsRepo } from "../models/syncLogs.repo";
import type { RefStateRepo } from "../models/refState.repo";
import { decideRef } from "./branchPlan";
import type { Direction, PlanItem, RefDecision, SyncPlan, SyncResult } from "./types";

export interface SyncEngineDeps {
  connectionsRepo: ConnectionsRepo;
  syncLogsRepo: SyncLogsRepo;
  refStateRepo: RefStateRepo;
  mirrorRoot: string;
  encryptionKey: Buffer;
}

interface Urls {
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

    let githubIsAncestorOfAzure = false;
    let azureIsAncestorOfGithub = false;
    let githubCommitDate: string | null = null;
    let azureCommitDate: string | null = null;

    if (githubSha && azureSha && githubSha !== azureSha) {
      [githubIsAncestorOfAzure, azureIsAncestorOfGithub] = await Promise.all([
        isAncestor(mirrorDir, githubSha, azureSha),
        isAncestor(mirrorDir, azureSha, githubSha),
      ]);
      if (!githubIsAncestorOfAzure && !azureIsAncestorOfGithub) {
        [githubCommitDate, azureCommitDate] = await Promise.all([
          commitDate(mirrorDir, githubSha),
          commitDate(mirrorDir, azureSha),
        ]);
      }
    }

    const decision = decideRef({
      refName: fullRefName,
      githubSha,
      azureSha,
      githubCommitDate,
      azureCommitDate,
      githubIsAncestorOfAzure,
      azureIsAncestorOfGithub,
      previouslySeen: previouslySeenRefs.has(fullRefName),
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

  const targetUrlFor = (direction: Direction) => (direction === "to-github" ? urls.githubAuthUrl : urls.azureAuthUrl);

  switch (decision.kind) {
    case "noop":
      return;

    case "create": {
      await runGit(["push", targetUrlFor(decision.direction), `${decision.sha}:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
      return;
    }

    case "fast-forward": {
      await runGit(["push", targetUrlFor(decision.direction), `${decision.toSha}:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
      return;
    }

    case "force-overwrite": {
      await runGit(
        ["push", "--force", targetUrlFor(decision.direction), `${decision.winningSha}:${refPrefix}/${shortName}`],
        { cwd: mirrorDir, timeoutMs: 60_000, secrets },
      );
      return;
    }

    case "delete": {
      await runGit(["push", targetUrlFor(decision.direction), `:${refPrefix}/${shortName}`], {
        cwd: mirrorDir,
        timeoutMs: 60_000,
        secrets,
      });
      return;
    }
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
    let hadForceOverwrite = false;

    for (const item of plan) {
      if (item.decision.kind === "noop") {
        // Both sides already agree - still record it so a later one-sided deletion
        // of this exact ref is recognized as a delete rather than a first-ever create.
        deps.refStateRepo.upsert(connectionId, item.refName, item.observedGithubSha, item.observedAzureSha);
        continue;
      }
      try {
        await applyDecision(mirrorDir, item, urls);

        if (item.decision.kind === "delete") {
          deps.refStateRepo.deleteRef(connectionId, item.refName);
        } else {
          const sha =
            item.decision.kind === "create"
              ? item.decision.sha
              : item.decision.kind === "fast-forward"
                ? item.decision.toSha
                : item.decision.winningSha;
          deps.refStateRepo.upsert(connectionId, item.refName, sha, sha);
        }

        if (item.decision.kind === "force-overwrite") {
          hadForceOverwrite = true;
          deps.syncLogsRepo.insert(connectionId, "warn", `FORCE-OVERWRITE on ${item.refName}: ${item.decision.reason}`, {
            branch: item.refName,
            direction: item.decision.direction,
            oldSha: item.decision.losingSha,
            newSha: item.decision.winningSha,
            forceOverwrite: true,
          });
        } else {
          deps.syncLogsRepo.insert(connectionId, "info", `${item.decision.kind} applied to ${item.refName}`, {
            branch: item.refName,
            direction: (item.decision as any).direction,
            forceOverwrite: false,
          });
        }
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

    const status = hadBranchError ? "error" : hadForceOverwrite ? "conflict" : "ok";
    deps.connectionsRepo.update(connectionId, {
      status,
      statusDetail: summarizePlan(plan),
      lastSyncedAt: new Date().toISOString(),
    });
    deps.syncLogsRepo.insert(connectionId, "info", "Sync completed", { status });

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
