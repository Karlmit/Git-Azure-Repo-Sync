/**
 * GitHub is the authoritative side. Whenever GitHub is ahead or equal (including a
 * GitHub-side delete), Azure DevOps is updated automatically - "push-to-azure" and
 * "delete-on-azure" always apply without pausing. Whenever Azure DevOps has *any*
 * content GitHub doesn't (a strict fast-forward-ahead, a true divergence, or a
 * brand-new Azure-only branch never seen before), nothing is pushed automatically -
 * "azure-ahead" always requires an explicit choice from the GUI. Azure-side
 * deletions are never propagated back to GitHub; if Azure loses something GitHub
 * still has, GitHub's copy is simply re-pushed (see decideRef for why).
 */
export type RefDecision =
  | { kind: "noop" }
  | { kind: "push-to-azure"; fromSha: string | null; toSha: string }
  | { kind: "delete-on-azure"; sha: string }
  | {
      kind: "azure-ahead";
      githubSha: string | null;
      azureSha: string;
      githubCommitDate: string | null;
      azureCommitDate: string;
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
