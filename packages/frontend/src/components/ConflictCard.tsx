import type { PendingConflict } from "../api/client";

function Side({
  label,
  sha,
  date,
  summary,
}: {
  label: string;
  sha: string;
  date: string;
  summary: string | null;
}) {
  return (
    <div style={{ flex: 1, padding: 8, background: "#f9fafb", borderRadius: 4 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>
        <code>{sha.slice(0, 7)}</code> &middot; {new Date(date).toLocaleString()}
      </div>
      {summary && <div style={{ fontSize: 13, marginTop: 4 }}>{summary}</div>}
    </div>
  );
}

export function ConflictCard({
  conflict,
  busy,
  onResolve,
}: {
  conflict: PendingConflict;
  busy: boolean;
  onResolve: (winner: "github" | "azure") => void;
}) {
  const shortName = conflict.refName.replace(/^refs\/(heads|tags)\//, "");
  return (
    <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 6, padding: 12, marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {conflict.isTag ? "Tag" : "Branch"}: {shortName}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Side label="GitHub" sha={conflict.githubSha} date={conflict.githubCommitDate} summary={conflict.githubSummary} />
        <Side label="Azure DevOps" sha={conflict.azureSha} date={conflict.azureCommitDate} summary={conflict.azureSummary} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={() => onResolve("github")}>
          Keep GitHub version
        </button>
        <button disabled={busy} onClick={() => onResolve("azure")}>
          Keep Azure DevOps version
        </button>
      </div>
    </div>
  );
}
