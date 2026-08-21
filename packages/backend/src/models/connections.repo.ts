import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { encryptSecret } from "../crypto/secretBox";
import type { Connection, ConnectionPublic, CreateConnectionInput, UpdateConnectionInput } from "./types";

function deriveAzureUrl(org: string, project: string, repo: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`;
}

function rowToConnection(row: any): Connection {
  return {
    id: row.id,
    name: row.name,
    githubUrl: row.github_url,
    azureOrg: row.azure_org,
    azureProject: row.azure_project,
    azureRepo: row.azure_repo,
    azureUrl: row.azure_url,
    githubPatCiphertext: row.github_pat_ciphertext,
    azurePatCiphertext: row.azure_pat_ciphertext,
    branchScope: row.branch_scope,
    branchList: row.branch_list ? JSON.parse(row.branch_list) : [],
    syncTags: !!row.sync_tags,
    pollIntervalMinutes: row.poll_interval_minutes,
    enabled: !!row.enabled,
    status: row.status,
    statusDetail: row.status_detail,
    lastSyncedAt: row.last_synced_at,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublic(conn: Connection): ConnectionPublic {
  const { githubPatCiphertext, azurePatCiphertext, ...rest } = conn;
  return {
    ...rest,
    githubPatSet: githubPatCiphertext.length > 0,
    azurePatSet: azurePatCiphertext.length > 0,
  };
}

export class ConnectionsRepo {
  constructor(private db: Database.Database, private encryptionKey: Buffer) {}

  create(input: CreateConnectionInput): Connection {
    const id = randomUUID();
    const azureUrl = input.azureUrlOverride ?? deriveAzureUrl(input.azureOrg, input.azureProject, input.azureRepo);
    this.db
      .prepare(
        `INSERT INTO connections (
          id, name, github_url, azure_org, azure_project, azure_repo, azure_url,
          github_pat_ciphertext, azure_pat_ciphertext, branch_scope, branch_list,
          sync_tags, poll_interval_minutes, enabled, status
        ) VALUES (@id, @name, @githubUrl, @azureOrg, @azureProject, @azureRepo, @azureUrl,
          @githubPat, @azurePat, @branchScope, @branchList, @syncTags, @pollIntervalMinutes, 1, 'idle')`,
      )
      .run({
        id,
        name: input.name,
        githubUrl: input.githubUrl,
        azureOrg: input.azureOrg,
        azureProject: input.azureProject,
        azureRepo: input.azureRepo,
        azureUrl,
        githubPat: encryptSecret(input.githubPat, this.encryptionKey),
        azurePat: encryptSecret(input.azurePat, this.encryptionKey),
        branchScope: input.branchScope,
        branchList: JSON.stringify(input.branchList ?? []),
        syncTags: input.syncTags ? 1 : 0,
        pollIntervalMinutes: input.pollIntervalMinutes,
      });
    return this.getById(id)!;
  }

  getById(id: string): Connection | null {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
    return row ? rowToConnection(row) : null;
  }

  listAll(): Connection[] {
    const rows = this.db.prepare("SELECT * FROM connections ORDER BY created_at ASC").all();
    return rows.map(rowToConnection);
  }

  update(id: string, patch: UpdateConnectionInput): Connection | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const params: Record<string, unknown> = { id };

    const setField = (column: string, key: keyof UpdateConnectionInput, transform?: (v: any) => any) => {
      if (patch[key] !== undefined) {
        fields.push(`${column} = @${column}`);
        params[column] = transform ? transform(patch[key]) : patch[key];
      }
    };

    setField("name", "name");
    setField("github_url", "githubUrl");
    setField("azure_org", "azureOrg");
    setField("azure_project", "azureProject");
    setField("azure_repo", "azureRepo");
    setField("branch_scope", "branchScope");
    setField("branch_list", "branchList", (v) => JSON.stringify(v ?? []));
    setField("sync_tags", "syncTags", (v) => (v ? 1 : 0));
    setField("poll_interval_minutes", "pollIntervalMinutes");
    setField("enabled", "enabled", (v) => (v ? 1 : 0));
    setField("status", "status");
    setField("status_detail", "statusDetail");
    setField("last_synced_at", "lastSyncedAt");
    setField("last_error_at", "lastErrorAt");

    if (patch.githubPat !== undefined) {
      fields.push("github_pat_ciphertext = @githubPatCt");
      params.githubPatCt = encryptSecret(patch.githubPat, this.encryptionKey);
    }
    if (patch.azurePat !== undefined) {
      fields.push("azure_pat_ciphertext = @azurePatCt");
      params.azurePatCt = encryptSecret(patch.azurePat, this.encryptionKey);
    }

    if (patch.azureOrg !== undefined || patch.azureProject !== undefined || patch.azureRepo !== undefined) {
      const org = patch.azureOrg ?? existing.azureOrg;
      const project = patch.azureProject ?? existing.azureProject;
      const repo = patch.azureRepo ?? existing.azureRepo;
      fields.push("azure_url = @azureUrl");
      params.azureUrl = deriveAzureUrl(org, project, repo);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    this.db.prepare(`UPDATE connections SET ${fields.join(", ")} WHERE id = @id`).run(params);
    return this.getById(id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  }
}
