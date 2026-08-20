import type { RefDecision, RefDecisionInput } from "./types";

/**
 * Direction always names the side that receives the write. "githubIsAncestorOfAzure"
 * means azure's tip is a descendant of github's tip (azure is ahead) -> github is the
 * side that needs to catch up, so the fast-forward direction is "to-github".
 */
export function decideRef(input: RefDecisionInput): RefDecision {
  const { githubSha, azureSha } = input;

  if (githubSha === azureSha) {
    return { kind: "noop" };
  }

  if (githubSha === null && azureSha !== null) {
    if (input.previouslySeen) {
      return { kind: "delete", direction: "to-azure", sha: azureSha };
    }
    return { kind: "create", direction: "to-github", sha: azureSha };
  }

  if (azureSha === null && githubSha !== null) {
    if (input.previouslySeen) {
      return { kind: "delete", direction: "to-github", sha: githubSha };
    }
    return { kind: "create", direction: "to-azure", sha: githubSha };
  }

  // Both sides have the ref, tips differ.
  if (input.githubIsAncestorOfAzure) {
    return { kind: "fast-forward", direction: "to-github", fromSha: githubSha, toSha: azureSha! };
  }
  if (input.azureIsAncestorOfGithub) {
    return { kind: "fast-forward", direction: "to-azure", fromSha: azureSha, toSha: githubSha! };
  }

  // True divergence (including totally unrelated histories, e.g. a freshly
  // auto-initialized empty repo on one side). Never auto-resolve this - it's
  // exactly the case where picking a "winner" automatically can silently
  // discard real work. Surface it as a pending conflict for a human to resolve.
  return {
    kind: "manual-conflict",
    githubSha: githubSha!,
    azureSha: azureSha!,
    githubCommitDate: input.githubCommitDate ?? "",
    azureCommitDate: input.azureCommitDate ?? "",
  };
}
