import type { RefDecision, RefDecisionInput } from "./types";

/**
 * GitHub is authoritative. Azure DevOps only ever gets auto-updated when GitHub is
 * ahead or equal; anything where Azure has content GitHub doesn't (strictly ahead,
 * truly diverged, or a brand-new Azure-only ref) always pauses for an explicit
 * choice in the GUI, never auto-resolved.
 */
export function decideRef(input: RefDecisionInput): RefDecision {
  const { githubSha, azureSha } = input;

  if (githubSha === azureSha) {
    return { kind: "noop" };
  }

  if (azureSha === null && githubSha !== null) {
    // Azure doesn't have it (brand new, or it lost it) - GitHub is authoritative,
    // so always (re)push regardless of history. This is also how an accidental
    // Azure-side deletion self-heals: GitHub's copy just gets pushed back.
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
      kind: "azure-ahead",
      githubSha: null,
      azureSha,
      githubCommitDate: null,
      azureCommitDate: input.azureCommitDate ?? "",
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
    kind: "azure-ahead",
    githubSha,
    azureSha: azureSha!,
    githubCommitDate: input.githubCommitDate,
    azureCommitDate: input.azureCommitDate ?? "",
  };
}
