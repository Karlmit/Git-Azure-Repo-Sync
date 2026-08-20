export type ConnectionStatus = "idle" | "syncing" | "ok" | "conflict" | "error";
export type BranchScope = "all" | "explicit";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ConnectionPublic {
  id: string;
  name: string;
  githubUrl: string;
  azureOrg: string;
  azureProject: string;
  azureRepo: string;
  azureUrl: string;
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
  githubPatSet: boolean;
  azurePatSet: boolean;
}

export interface SyncLogRow {
  id: number;
  connectionId: string;
  ts: string;
  level: LogLevel;
  message: string;
  details: Record<string, unknown> | null;
}

export interface LogsPage {
  items: SyncLogRow[];
  nextCursor: number | null;
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
}

export type UpdateConnectionInput = Partial<CreateConnectionInput> & { enabled?: boolean };

export type RefDecisionKind = "noop" | "create" | "fast-forward" | "manual-conflict" | "delete";

export interface SyncPlanItem {
  refName: string;
  isTag: boolean;
  decision: { kind: RefDecisionKind; [key: string]: unknown };
}

export interface SyncOutcome {
  connectionId: string;
  status: "ok" | "conflict" | "error";
  plan: SyncPlanItem[];
  error?: string;
}

export interface PendingConflict {
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

export type ConflictWinner = "github" | "azure";

export interface TestAccessResult {
  ok: boolean;
  message: string;
}

export interface TestConnectionResult {
  github: TestAccessResult;
  azure: TestAccessResult;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.error ? JSON.stringify(body.error) : message;
    } catch {
      // ignore body parse errors
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export { ApiError };

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: true }>("/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>("/logout", { method: "POST" }),
  me: () => request<{ authenticated: true }>("/me"),
  version: () => request<{ version: string }>("/version"),

  listConnections: () => request<ConnectionPublic[]>("/connections"),
  getConnection: (id: string) => request<ConnectionPublic>(`/connections/${id}`),
  createConnection: (input: CreateConnectionInput) =>
    request<ConnectionPublic>("/connections", { method: "POST", body: JSON.stringify(input) }),
  updateConnection: (id: string, input: UpdateConnectionInput) =>
    request<ConnectionPublic>(`/connections/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteConnection: (id: string) => request<void>(`/connections/${id}`, { method: "DELETE" }),
  pauseConnection: (id: string) => request<ConnectionPublic>(`/connections/${id}/pause`, { method: "POST" }),
  resumeConnection: (id: string) => request<ConnectionPublic>(`/connections/${id}/resume`, { method: "POST" }),
  syncNow: (id: string) => request<SyncOutcome>(`/connections/${id}/sync-now`, { method: "POST" }),

  listLogs: (id: string, opts: { cursor?: number; limit?: number; level?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor !== undefined) params.set("cursor", String(opts.cursor));
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.level) params.set("level", opts.level);
    const qs = params.toString();
    return request<LogsPage>(`/connections/${id}/logs${qs ? `?${qs}` : ""}`);
  },

  listConflicts: (id: string) => request<PendingConflict[]>(`/connections/${id}/conflicts`),
  resolveConflict: (id: string, refName: string, winner: ConflictWinner) =>
    request<{ winningSha: string }>(`/connections/${id}/conflicts/resolve`, {
      method: "POST",
      body: JSON.stringify({ refName, winner }),
    }),

  testNewConnection: (input: {
    githubUrl: string;
    githubPat: string;
    azureOrg: string;
    azureProject: string;
    azureRepo: string;
    azurePat: string;
  }) => request<TestConnectionResult>("/connections/test", { method: "POST", body: JSON.stringify(input) }),
  testExistingConnection: (id: string, overrides: { githubPat?: string; azurePat?: string }) =>
    request<TestConnectionResult>(`/connections/${id}/test`, { method: "POST", body: JSON.stringify(overrides) }),
};
