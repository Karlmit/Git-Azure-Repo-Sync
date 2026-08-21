export interface NewlyPausedRef {
  refName: string;
  isTag: boolean;
  githubSha: string | null;
  azureSha: string | null;
  githubCommitDate: string | null;
  azureCommitDate: string | null;
  githubSummary: string | null;
  azureSummary: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sideText(sha: string | null, date: string | null, summary: string | null, missingLabel: string): string {
  if (!sha) return `<i>${missingLabel}</i>`;
  const when = date ? new Date(date).toLocaleString() : "";
  const message = summary ? escapeHtml(summary) : "(no commit message)";
  return `${message} <code>${sha.slice(0, 7)}</code> ${when}`.trim();
}

export function formatPauseNotification(
  connectionName: string,
  items: NewlyPausedRef[],
  link?: { baseUrl: string; connectionId: string },
): string {
  const rows = items
    .map((item) => {
      const shortName = escapeHtml(item.refName.replace(/^refs\/(heads|tags)\//, ""));
      const kind = item.isTag ? "tag" : "branch";
      const github = sideText(item.githubSha, item.githubCommitDate, item.githubSummary, "doesn't exist yet");
      const azure = sideText(item.azureSha, item.azureCommitDate, item.azureSummary, "deleted on Azure DevOps");
      return `<li><b>${shortName}</b> (${kind})<br>GitHub: ${github}<br>Azure DevOps: ${azure}</li>`;
    })
    .join("");

  const count = items.length;
  const linkHtml = link
    ? `<br><a href="${escapeHtml(link.baseUrl.replace(/\/+$/, ""))}/connections/${escapeHtml(link.connectionId)}">Open in gitsync</a>`
    : "";

  return (
    `<b>gitsync:</b> connection "<b>${escapeHtml(connectionName)}</b>" needs your decision on ${count} ref${count === 1 ? "" : "s"}:` +
    `<ul>${rows}</ul>${linkHtml}`
  );
}
