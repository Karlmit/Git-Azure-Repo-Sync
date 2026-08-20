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

test("both sides empty: first sync is a no-op with status ok", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const conn = createConnection(deps, github, azure);

  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  assert.equal(result.plan.length, 0);
});

test("one side empty: branch is created on the empty side", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();
  const sha = fx.commitFile(work, "hello");
  fx.push(work, github, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  const created = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(created?.decision.kind, "create");
  assert.equal(revParse(azure), sha);
});

test("clean fast-forward: lagging side catches up without force", async () => {
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
  assert.equal(item?.decision.kind, "fast-forward");
  assert.equal(revParse(azure), sha2);
  assert.equal(revParse(github), sha2);
});

test("true divergence with common ancestor: pauses as a pending conflict, nothing is pushed automatically", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const base = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  const older = fx.commitFile(work, "older-branch", "2020-01-01T00:00:00Z");
  fx.push(work, azure, "main");

  fx.resetHard(work, base);
  const newer = fx.commitFile(work, "newer-branch", "2024-01-01T00:00:00Z");
  fx.push(work, github, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const item = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(item?.decision.kind, "manual-conflict");
  if (item?.decision.kind === "manual-conflict") {
    assert.equal(item.decision.githubSha, newer);
    assert.equal(item.decision.azureSha, older);
  }

  // Nothing was pushed - both remotes are exactly as the sync found them.
  assert.equal(revParse(azure), older);
  assert.equal(revParse(github), newer);

  const conflict = deps.pendingConflictsRepo.get(conn.id, "refs/heads/main");
  assert.ok(conflict);
  assert.equal(conflict?.githubSha, newer);
  assert.equal(conflict?.azureSha, older);
});

test("unrelated histories: also pauses as a pending conflict, no special-casing needed", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();

  const workA = fx.makeWorkTree();
  const shaOld = fx.commitFile(workA, "independent-a", "2019-06-01T00:00:00Z");
  fx.push(workA, github, "main");

  const workB = fx.makeWorkTree();
  const shaNew = fx.commitFile(workB, "independent-b", "2024-06-01T00:00:00Z");
  fx.push(workB, azure, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const item = result.plan.find((p) => p.refName === "refs/heads/main");
  assert.equal(item?.decision.kind, "manual-conflict");
  assert.equal(revParse(github), shaOld);
  assert.equal(revParse(azure), shaNew);
});

test("resolveConflict: applying the chosen side pushes it, clears the pending conflict, and status returns to ok", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const base = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  const older = fx.commitFile(work, "older-branch", "2020-01-01T00:00:00Z");
  fx.push(work, azure, "main");

  fx.resetHard(work, base);
  const newer = fx.commitFile(work, "newer-branch", "2024-01-01T00:00:00Z");
  fx.push(work, github, "main");

  const conn = createConnection(deps, github, azure);
  await runSyncForConnection(deps, conn.id);
  assert.equal(deps.connectionsRepo.getById(conn.id)?.status, "conflict");

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/heads/main", "github");

  assert.equal(winningSha, newer);
  assert.equal(revParse(azure), newer); // losing side (azure) force-updated to match github
  assert.equal(revParse(github), newer);
  assert.equal(deps.pendingConflictsRepo.get(conn.id, "refs/heads/main"), null);
  assert.equal(deps.connectionsRepo.getById(conn.id)?.status, "ok");

  // A subsequent sync sees both sides equal now - no conflict resurfaces.
  const second = await runSyncForConnection(deps, conn.id);
  assert.equal(second.status, "ok");
});

test("a conflict that resolves itself (one side fast-forwarded since detection) is pruned automatically", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const base = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  fx.commitFile(work, "older-branch", "2020-01-01T00:00:00Z");
  fx.push(work, azure, "main");

  fx.resetHard(work, base);
  fx.commitFile(work, "newer-branch", "2024-01-01T00:00:00Z");
  fx.push(work, github, "main");

  const conn = createConnection(deps, github, azure);
  await runSyncForConnection(deps, conn.id);
  assert.ok(deps.pendingConflictsRepo.get(conn.id, "refs/heads/main"));

  // Someone manually fast-forwards azure's main onto github's version outside gitsync.
  require("node:child_process").execFileSync("git", ["-C", work, "push", "-f", azure, "main"]);

  const result = await runSyncForConnection(deps, conn.id);
  assert.equal(result.status, "ok");
  assert.equal(deps.pendingConflictsRepo.get(conn.id, "refs/heads/main"), null);
});

test("branch deletion propagates only after a prior successful sync, never on first sync", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  // "main" stays untouched throughout (it's HEAD on both bare repos, which real git
  // servers refuse to delete via push anyway) - the interesting ref is "feature".
  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  require("node:child_process").execFileSync("git", ["-C", work, "checkout", "-b", "feature"]);
  fx.push(work, github, "feature");
  fx.push(work, azure, "feature");

  const conn = createConnection(deps, github, azure);
  const first = await runSyncForConnection(deps, conn.id);
  assert.equal(first.status, "ok");

  // Delete the "feature" branch on GitHub only.
  require("node:child_process").execFileSync("git", ["-C", github, "branch", "-D", "feature"]);

  const second = await runSyncForConnection(deps, conn.id);
  assert.equal(second.status, "ok");
  const item = second.plan.find((p) => p.refName === "refs/heads/feature");
  assert.equal(item?.decision.kind, "delete");
  assert.equal(revParse(azure, "refs/heads/feature"), null);
});

test("tag creation propagates to the side missing it", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const sha1 = fx.commitFile(work, "v1", "2023-01-01T00:00:00Z");
  fx.push(work, github, "main");
  fx.tagAt(work, "v1.0.0", sha1);
  require("node:child_process").execFileSync("git", ["-C", work, "push", "-f", github, "v1.0.0"]);

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "ok");
  const tagItem = result.plan.find((p) => p.refName === "refs/tags/v1.0.0");
  assert.equal(tagItem?.decision.kind, "create");
  assert.equal(revParse(azure, "refs/tags/v1.0.0"), sha1);
});

test("a moved tag that diverges also pauses as a pending conflict instead of auto-resolving", async () => {
  const deps = createDeps();
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  const base = fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");

  const shaA = fx.commitFile(work, "tag-target-a", "2021-01-01T00:00:00Z");
  fx.tagAt(work, "v1.0.0", shaA);
  require("node:child_process").execFileSync("git", ["-C", work, "push", "-f", github, "v1.0.0"]);

  fx.resetHard(work, base);
  const shaB = fx.commitFile(work, "tag-target-b", "2022-01-01T00:00:00Z");
  fx.tagAt(work, "v1.0.0", shaB);
  require("node:child_process").execFileSync("git", ["-C", work, "push", "-f", azure, "v1.0.0"]);

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const tagItem = result.plan.find((p) => p.refName === "refs/tags/v1.0.0");
  assert.equal(tagItem?.decision.kind, "manual-conflict");
  assert.equal(revParse(github, "refs/tags/v1.0.0"), shaA);
  assert.equal(revParse(azure, "refs/tags/v1.0.0"), shaB);

  const { winningSha } = await resolveConflict(deps, conn.id, "refs/tags/v1.0.0", "azure");
  assert.equal(winningSha, shaB);
  assert.equal(revParse(github, "refs/tags/v1.0.0"), shaB);
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
