import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate";
import { ConnectionsRepo } from "../src/models/connections.repo";
import { SyncLogsRepo } from "../src/models/syncLogs.repo";
import { RefStateRepo } from "../src/models/refState.repo";
import { PendingConflictsRepo } from "../src/models/pendingConflicts.repo";
import { runSyncForConnection, type SyncEngineDeps } from "../src/sync/engine";
import type { CreateConnectionInput } from "../src/models/types";
import * as fx from "./fixtures/localRemotes";

function startCaptureServer(): Promise<{ url: string; requests: Array<{ message: string }>; close: () => Promise<void> }> {
  const requests: Array<{ message: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function createDeps(notifyWebhookUrl?: string, appBaseUrl?: string): SyncEngineDeps {
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
    notifyWebhookUrl,
    appBaseUrl,
  };
}

function createConnection(
  deps: SyncEngineDeps,
  githubBareDir: string,
  azureBareDir: string,
  overrides: Partial<CreateConnectionInput> = {},
) {
  return deps.connectionsRepo.create({
    name: "notify-test",
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
    pollIntervalMinutes: 2,
    ...overrides,
  });
}

test("sends exactly one notification when a ref newly needs approval, not on repeated polls of the same unresolved conflict", async () => {
  const capture = await startCaptureServer();
  try {
    const deps = createDeps(capture.url);
    const github = fx.makeBareRepo();
    const azure = fx.makeBareRepo();
    const work = fx.makeWorkTree();

    fx.commitFile(work, "base");
    fx.push(work, github, "main");
    fx.push(work, azure, "main");
    fx.commitFile(work, "azure-work");
    fx.push(work, azure, "main");

    const conn = createConnection(deps, github, azure);

    const first = await runSyncForConnection(deps, conn.id);
    assert.equal(first.status, "conflict");
    assert.equal(capture.requests.length, 1);
    assert.match(capture.requests[0].message, /needs your decision/);
    assert.match(capture.requests[0].message, /notify-test/);

    const second = await runSyncForConnection(deps, conn.id);
    assert.equal(second.status, "conflict");
    assert.equal(capture.requests.length, 1, "should not re-notify while still unresolved");
  } finally {
    await capture.close();
  }
});

test("includes a deep link to the connection when APP_BASE_URL is configured", async () => {
  const capture = await startCaptureServer();
  try {
    const deps = createDeps(capture.url, "http://192.168.1.66:3012/");
    const github = fx.makeBareRepo();
    const azure = fx.makeBareRepo();
    const work = fx.makeWorkTree();

    fx.commitFile(work, "base");
    fx.push(work, github, "main");
    fx.push(work, azure, "main");
    fx.commitFile(work, "azure-work");
    fx.push(work, azure, "main");

    const conn = createConnection(deps, github, azure);
    await runSyncForConnection(deps, conn.id);

    assert.equal(capture.requests.length, 1);
    assert.equal(
      capture.requests[0].message.includes(`href="http://192.168.1.66:3012/connections/${conn.id}"`),
      true,
    );
  } finally {
    await capture.close();
  }
});

test("does not send anything when NOTIFY_WEBHOOK_URL is not configured", async () => {
  const capture = await startCaptureServer();
  try {
    const deps = createDeps(undefined);
    const github = fx.makeBareRepo();
    const azure = fx.makeBareRepo();
    const work = fx.makeWorkTree();

    fx.commitFile(work, "base");
    fx.push(work, github, "main");
    fx.push(work, azure, "main");
    fx.commitFile(work, "azure-work");
    fx.push(work, azure, "main");

    const conn = createConnection(deps, github, azure);
    await runSyncForConnection(deps, conn.id);

    assert.equal(capture.requests.length, 0);
  } finally {
    await capture.close();
  }
});

test("a webhook failure is logged but does not fail the sync itself", async () => {
  const deps = createDeps("http://127.0.0.1:1"); // nothing listens here - connection refused
  const github = fx.makeBareRepo();
  const azure = fx.makeBareRepo();
  const work = fx.makeWorkTree();

  fx.commitFile(work, "base");
  fx.push(work, github, "main");
  fx.push(work, azure, "main");
  fx.commitFile(work, "azure-work");
  fx.push(work, azure, "main");

  const conn = createConnection(deps, github, azure);
  const result = await runSyncForConnection(deps, conn.id);

  assert.equal(result.status, "conflict");
  const logs = deps.syncLogsRepo.listByConnection(conn.id, { limit: 20 });
  assert.ok(logs.items.some((l) => l.message.includes("Failed to send pause notification")));
});
