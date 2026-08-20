import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate";
import { ConnectionsRepo } from "../src/models/connections.repo";
import { SyncLogsRepo } from "../src/models/syncLogs.repo";
import { RefStateRepo } from "../src/models/refState.repo";
import { PendingConflictsRepo } from "../src/models/pendingConflicts.repo";
import { runSyncForConnection, type SyncEngineDeps } from "../src/sync/engine";
import { resolveConflict } from "../src/sync/resolveConflict";
import { Scheduler } from "../src/scheduler/scheduler";
import type { CreateConnectionInput } from "../src/models/types";
import * as fx from "./fixtures/localRemotes";

function createDeps(): SyncEngineDeps {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  const encryptionKey = randomBytes(32);
  return {
    connectionsRepo: new ConnectionsRepo(db, encryptionKey),
    syncLogsRepo: new SyncLogsRepo(db),
    refStateRepo: new RefStateRepo(db),
    pendingConflictsRepo: new PendingConflictsRepo(db),
    mirrorRoot: fx.makeTempDir("gitsync-mirror-"),
    encryptionKey,
  };
}

function createConnection(
  deps: SyncEngineDeps,
  githubBareDir: string,
  azureBareDir: string,
  overrides: Partial<CreateConnectionInput> = {},
) {
  return deps.connectionsRepo.create({
    name: "test-connection",
    githubUrl: fx.fileUrl(githubBareDir),
    azureOrg: "org",
    azureProject: "proj",
    azureRepo: "repo",
    azureUrlOverride: fx.fileUrl(azureBareDir),
    githubPat: "dummy-github-pat",
    azurePat: "dummy-azure-pat",
    branchScope: "all",
    branchList: [],
    syncTags: true,
    pollIntervalSeconds: 120,
    ...overrides,
  });
}

function revParse(bareDir: string, ref = "refs/heads/main"): string | null {
  try {
    return require("node:child_process").execFileSync("git", ["-C", bareDir, "rev-parse", ref]).toString().trim();
  } catch {
    return null;
  }
}

function sh(...args: string[]): string {
  return require("node:child_process").execFileSync("git", args).toString().trim();
}

test("both sides empty: first sync is a no-op with status ok", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const conn = createConnection(deps, github, azure);

  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  assert.equal(result.plan.length, 0);
});

test("GitHub-only branch (Azure empty): pushed to Azure automatically", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();
  const sha = fx.commitFile(work, "hello");
  fx.push(work, github, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  const item = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(item?.decision.kind, "push-to-azure");
  assert.equal(revParse(azure), sha);
});

test("GitHub ahead (clean fast-forward): pushed to Azure automatically", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const sha1 = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  const sha2 = fx.commitFile(work, "ahead");
  fx.push(work, github, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  const item = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(item?.decision.kind, "push-to-azure");
  assert.equal(revParse(azure), sha2);
  assert.equal(revParse(github), sha2);
});

test("Azure strictly ahead (clean ancestor, but Azure): pauses instead of auto-fast-forwarding GitHub", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const sha1 = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  const sha2 = fx.commitFile(work, "colleague-work-on-azure");
  fx.push(work, azure, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const item = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(item?.decision.kind, "azure-ahead");
  if (item?.decision.kind === "azure-ahead") {
    assert.equal(item.decision.githubSha, sha1);
    assert.equal(item.decision.azureSha, sha2);
  }
  // Nothing was pushed - GitHub did NOT get auto-fast-forwarded.
  assert.equal(revParse(github), sha1);
  assert.equal(revParse(azure), sha2);
});

test("true divergence (unrelated histories) also pauses as azure-ahead", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();

  const workA = fx.makeWorkTree();
  const shaGithub = fx.commitFile(workA, "independent-a");
  fx.push(workA, github, "main");

  const workB = fx.makeWorkTree();
  const shaAzure = fx.commitFile(workB, "independent-b");
  fx.push(workB, azure, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const item = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(item?.decision.kind, "azure-ahead");
  assert.equal(revParse(github), shaGithub);
  assert.equal(revParse(azure), shaAzure);
});

test("resolveConflict accept: pulls Azure's version into GitHub", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  const azureAhead = fx.commitFile(work, "azure-work");
  fx.push(work, azure, "main");

  const conn = createConnection(deps, github, azure);
  await runSyncForConnection(deps, conn.id);
  assert.equal(deps.connectionsRepo.getById(conn.id)?.status, "conflict");

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/heads/main", "azure");

  assert.equal(winningSha, azureAhead);
  assert.equal(revParse(github), azureAhead);
  assert.equal(deps.pendingConflictsRepo.get(conn.id, "refs/heads/main"), null);
  assert.equal(deps.connectionsRepo.getById(conn.id)?.status, "ok");

  const second = await runSyncForConnection(deps, conn.id);
  assert.equal(second.status, "ok");
});

test("resolveConflict reject: discards Azure's version, force-pushes GitHub's over it", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const base = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  fx.commitFile(work, "azure-junk-commit");
  fx.push(work, azure, "main");

  const conn = createConnection(deps, github, azure);
  await runSyncForConnection(deps, conn.id);

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/heads/main", "github");

  assert.equal(winningSha, base);
  assert.equal(revParse(azure), base);
  assert.equal(revParse(github), base);
  assert.equal(deps.pendingConflictsRepo.get(conn.id, "refs/heads/main"), null);
  assert.equal(deps.connectionsRepo.getById(conn.id)?.status, "ok");
});

test("brand-new Azure-only branch pauses for approval instead of auto-importing", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  sh("-C", work, "checkout", "-b", "azure-only-feature");
  const featureSha = fx.commitFile(work, "azure-only-work");
  fx.push(work, azure, "azure-only-feature");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const item = result.plan.find((p) => p.refName === "refs/heads/azure-only-feature");
  assert.equal(item?.decision.kind, "azure-ahead");
  if (item?.decision.kind === "azure-ahead") {
    assert.equal(item.decision.githubSha, null);
    assert.equal(item.decision.azureSha, featureSha);
  }
  assert.equal(revParse(github, "refs/heads/azure-only-feature"), null);

  const conflict = deps.pendingConflictsRepo.get(conn.id, "refs/heads/azure-only-feature");
  assert.equal(conflict?.githubSha, null);
});

test("brand-new Azure-only branch: accepting imports it into GitHub", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  sh("-C", work, "checkout", "-b", "azure-only-feature");
  const featureSha = fx.commitFile(work, "azure-only-work");
  fx.push(work, azure, "azure-only-feature");

  const conn = createConnection(deps, github, azure);
  await runSyncForConnection(deps, conn.id);

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/heads/azure-only-feature", "azure");

  assert.equal(winningSha, featureSha);
  assert.equal(revParse(github, "refs/heads/azure-only-feature"), featureSha);
});

test("brand-new Azure-only branch: rejecting deletes it from Azure DevOps", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  sh("-C", work, "checkout", "-b", "azure-only-feature");
  fx.commitFile(work, "azure-only-work");
  fx.push(work, azure, "azure-only-feature");

  const conn = createConnection(deps, github, azure);
  await runSyncForConnection(deps, conn.id);

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/heads/azure-only-feature", "github");

  assert.equal(winningSha, null);
  assert.equal(revParse(azure, "refs/heads/azure-only-feature"), null);
  assert.equal(revParse(github, "refs/heads/azure-only-feature"), null);
});

test("GitHub-side branch deletion propagates to Azure DevOps automatically", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  sh("-C", work, "checkout", "-b", "feature");
  fx.push(work, github, "feature");
  fx.push(work, azure, "feature");

  const conn = createConnection(deps, github, azure);
  const first = await runSyncForConnection(deps, conn.id);
  assert.equal(first.status, "ok");

  sh("-C", github, "branch", "-D", "feature");

  const second = await runSyncForConnection(deps, conn.id);
  assert.equal(second.status, "ok");
  const item = second.plan.find((p) => p.refName === "refs/heads/feature");
  assert.equal(item?.decision.kind, "delete-on-azure");
  assert.equal(revParse(azure, "refs/heads/feature"), null);
});

test("Azure-side branch deletion does NOT propagate to GitHub - GitHub's copy is re-pushed instead", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  sh("-C", work, "checkout", "-b", "feature");
  const featureSha = fx.commitFile(work, "feature-work");
  fx.push(work, github, "feature");
  fx.push(work, azure, "feature");

  const conn = createConnection(deps, github, azure);
  const first = await runSyncForConnection(deps, conn.id);
  assert.equal(first.status, "ok");

  // Someone deletes "feature" on Azure DevOps only. GitHub still has it.
  sh("-C", azure, "branch", "-D", "feature");

  const second = await runSyncForConnection(deps, conn.id);
  assert.equal(second.status, "ok");
  const item = second.plan.find((p) => p.refName === "refs/heads/feature");
  assert.equal(item?.decision.kind, "push-to-azure");
  // GitHub still has it, and it's been recreated on Azure DevOps to match.
  assert.equal(revParse(github, "refs/heads/feature"), featureSha);
  assert.equal(revParse(azure, "refs/heads/feature"), featureSha);
});

test("tag creation propagates to the side missing it", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const sha1 = fx.commitFile(work, "v1");
  fx.push(work, github, "main");
  fx.tagAt(work, "v1.0.0", sha1);
  sh("-C", work, "push", "-f", github, "v1.0.0");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  const tagItem = result.plan.find((p) => p.refName === "refs/tags/v1.0.0");
  assert.equal(tagItem?.decision.kind, "push-to-azure");
  assert.equal(revParse(azure, "refs/tags/v1.0.0"), sha1);
});

test("a moved tag where Azure is ahead also pauses as azure-ahead", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const base = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  fx.tagAt(work, "v1.0.0", base);
  sh("-C", work, "push", "-f", github, "v1.0.0");
  sh("-C", work, "push", "-f", azure, "v1.0.0");

  const moved = fx.commitFile(work, "tag-moved-on-azure");
  fx.tagAt(work, "v1.0.0", moved);
  sh("-C", work, "push", "-f", azure, "v1.0.0");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const tagItem = result.plan.find((p) => p.refName === "refs/tags/v1.0.0");
  assert.equal(tagItem?.decision.kind, "azure-ahead");
  assert.equal(revParse(github, "refs/tags/v1.0.0"), base);
  assert.equal(revParse(azure, "refs/tags/v1.0.0"), moved);

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/tags/v1.0.0", "azure");
  assert.equal(winningSha, moved);
  assert.equal(revParse(github, "refs/tags/v1.0.0"), moved);
});

test("scheduler mutex: a manual trigger while a run is in-flight awaits the same run instead of starting a second one", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const conn = createConnection(deps, github, azure);
  const scheduler = new Scheduler(deps);

  const [a, b] = await Promise.all([scheduler.triggerSync(conn.id), scheduler.triggerSync(conn.id)]);

  // Both callers observe the exact same SyncResult object because the second call
  // returned the first call's in-flight promise rather than starting a concurrent
  // `git` process pair against the same mirror directory.
  assert.equal(a, b);
  assert.equal(a.status, "ok");
});

test("scheduler mutex: resolveConflict rejects while a sync is in-flight for the same connection", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const conn = createConnection(deps, github, azure);
  const scheduler = new Scheduler(deps);

  const syncPromise = scheduler.triggerSync(conn.id);
  await assert.rejects(
    () => scheduler.resolveConflict(conn.id, "refs/heads/main", "github"),
    /sync is currently in progress/,
  );
  await syncPromise;
});

test("unreachable remote is classified as an error, not a crash", async () => {
  const deps = createDeps();
  const azure = fx.makeBareRepo();
  const conn = createConnection(deps, "file:///nonexistent/path/does-not-exist.git", azure);

  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "error");
  assert.ok(result.error);
});
