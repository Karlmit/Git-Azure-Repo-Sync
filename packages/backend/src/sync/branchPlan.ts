import type { RefDecision, RefDecisionInput } from "./types";

/**
 * GitHub is authoritative. Azure DevOps only ever gets auto-updated when GitHub is
 * ahead or equal (including GitHub deleting something). Anything where Azure DevOps
 * has unique state relative to GitHub - strictly ahead, truly diverged, a brand-new
 * Azure-only ref, or Azure DevOps having deleted a ref GitHub still has - always
 * pauses for an explicit choice in the GUI, never auto-resolved.
 */
export function decideRef(input: RefDecisionInput): RefDecision {
  const { githubSha, azureSha } = input;

  if (githubSha === azureSha) {
    return { kind: "noop" };
  }

  if (azureSha === null && githubSha !== null) {
    if (input.previouslySeen) {
      // Azure DevOps deleted something that used to exist on both sides - don't
      // assume that was accidental (auto-recreate) or intentional (auto-delete from
      // GitHub too). Pause and let a human decide.
      return {
        kind: "needs-approval",
        githubSha,
        azureSha: null,
        githubCommitDate: input.githubCommitDate,
        azureCommitDate: null,
      };
    }
    // Never synced before - GitHub is authoritative, so just push it across.
    return { kind: "push-to-azure", fromSha: null, toSha: githubSha };
  }

  if (githubSha === null && azureSha !== null) {
    if (input.previouslySeen) {
      // GitHub intentionally deleted something that used to exist on both sides -
      // mirror that deletion onto Azure.
      return { kind: "delete-on-azure", sha: azureSha };
    }
    // A ref that has only ever existed on Azure DevOps - needs an explicit choice
    // before it's imported into GitHub, even though nothing would be overwritten.
    return {
      kind: "needs-approval",
      githubSha: null,
      azureSha,
      githubCommitDate: null,
      azureCommitDate: input.azureCommitDate,
    };
  }

  // Both sides have the ref, tips differ.
  if (input.azureIsAncestorOfGithub) {
    // GitHub is strictly ahead - nothing on Azure is lost by catching it up.
    return { kind: "push-to-azure", fromSha: azureSha, toSha: githubSha! };
  }

  // Azure has commits GitHub doesn't - whether it's cleanly ahead of GitHub or
  // truly diverged, both cases mean accepting it would require a decision, so
  // both pause identically. This is also what protects against the failure mode
  // that caused real damage before: an auto-generated placeholder commit on Azure
  // being "newer" than real GitHub work is no longer a signal this code trusts.
  return {
    kind: "needs-approval",
    githubSha,
    azureSha: azureSha!,
    githubCommitDate: input.githubCommitDate,
    azureCommitDate: input.azureCommitDate,
  };
}
