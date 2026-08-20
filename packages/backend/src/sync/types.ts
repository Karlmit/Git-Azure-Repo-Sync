export type Direction = "to-github" | "to-azure";

export type RefDecision =
  | { kind: "noop" }
  | { kind: "create"; direction: Direction; sha: string }
  | { kind: "fast-forward"; direction: Direction; fromSha: string | null; toSha: string }
  | { kind: "force-overwrite"; direction: Direction; winningSha: string; losingSha: string; reason: string }
  | { kind: "delete"; direction: Direction; sha: string };

export interface RefDecisionInput {
  refName: string;
  githubSha: string | null;
  azureSha: string | null;
  githubCommitDate: string | null;
  azureCommitDate: string | null;
  githubIsAncestorOfAzure: boolean;
  azureIsAncestorOfGithub: boolean;
  previouslySeen: boolean;
}

export interface PlanItem {
  refName: string;
  isTag: boolean;
  decision: RefDecision;
  /** Shas observed at fetch time, before any push - used to record noop refs into ref-state for delete-detection. */
  observedGithubSha: string | null;
  observedAzureSha: string | null;
}

export type SyncPlan = PlanItem[];

export interface SyncResult {
  connectionId: string;
  status: "ok" | "conflict" | "error";
  plan: SyncPlan;
  error?: string;
}
