export type ConnectionStatus = "idle" | "syncing" | "ok" | "conflict" | "error";
export type BranchScope = "all" | "explicit";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Connection {
  id: string;
  name: string;
  githubUrl: string;
  azureOrg: string;
  azureProject: string;
  azureRepo: string;
  azureUrl: string;
  githubPatCiphertext: Buffer;
  azurePatCiphertext: Buffer;
  branchScope: BranchScope;
  branchList: string[];
  syncTags: boolean;
  pollIntervalSeconds: number;
  enabled: boolean;
  status: ConnectionStatus;
  statusDetail: string | null;
  lastSyncedAt: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionPublic extends Omit<Connection, "githubPatCiphertext" | "azurePatCiphertext"> {
  githubPatSet: boolean;
  azurePatSet: boolean;
}

export interface CreateConnectionInput {
  name: string;
  githubUrl: string;
  azureOrg: string;
  azureProject: string;
  azureRepo: string;
  githubPat: string;
  azurePat: string;
  branchScope: BranchScope;
  branchList: string[];
  syncTags: boolean;
  pollIntervalSeconds: number;
  /** Test-only hook: overrides the derived dev.azure.com URL (e.g. with a local file:// bare repo). */
  azureUrlOverride?: string;
}

export interface UpdateConnectionInput {
  name?: string;
  githubUrl?: string;
  azureOrg?: string;
  azureProject?: string;
  azureRepo?: string;
  githubPat?: string;
  azurePat?: string;
  branchScope?: BranchScope;
  branchList?: string[];
  syncTags?: boolean;
  pollIntervalSeconds?: number;
  enabled?: boolean;
  status?: ConnectionStatus;
  statusDetail?: string | null;
  lastSyncedAt?: string | null;
  lastErrorAt?: string | null;
}

export interface SyncLogRow {
  id: number;
  connectionId: string;
  ts: string;
  level: LogLevel;
  message: string;
  details: Record<string, unknown> | null;
}

export interface RefStateRow {
  connectionId: string;
  refName: string;
  githubSha: string | null;
  azureSha: string | null;
  updatedAt: string;
}

export interface PendingConflictRow {
  connectionId: string;
  refName: string;
  isTag: boolean;
  githubSha: string;
  azureSha: string;
  githubCommitDate: string;
  azureCommitDate: string;
  githubSummary: string | null;
  azureSummary: string | null;
  detectedAt: string;
}
