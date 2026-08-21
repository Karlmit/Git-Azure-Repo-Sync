/**
 * GitHub is the authoritative side. Whenever GitHub is ahead or equal - a new
 * commit, a brand-new GitHub branch, or GitHub deleting a branch it used to have -
 * Azure DevOps is updated automatically ("push-to-azure" / "delete-on-azure").
 * Anything where Azure DevOps has unique state - strictly ahead, truly diverged, a
 * brand-new Azure-only ref, *or* Azure DevOps having deleted a ref GitHub still has
 * - always pauses as "needs-approval" instead of guessing. Resolution is symmetric:
 * picking a side force-updates the *other* side to match it, including deleting a
 * ref there if the winning side doesn't have it at all.
 */
export type RefDecision =
  | { kind: "noop" }
  | { kind: "push-to-azure"; fromSha: string | null; toSha: string }
  | { kind: "delete-on-azure"; sha: string }
  | {
      kind: "needs-approval";
      githubSha: string | null;
      azureSha: string | null;
      githubCommitDate: string | null;
      azureCommitDate: string | null;
    };

export interface RefDecisionInput {
  refName: string;
  githubSha: string | null;
  azureSha: string | null;
  githubCommitDate: string | null;
  azureCommitDate: string | null;
  /** Whether azureSha is an ancestor of githubSha, i.e. GitHub is ahead (or equal) - the only case that auto-applies. */
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
