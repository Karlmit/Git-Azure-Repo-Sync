import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type ConflictWinner, type SyncLogRow } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { LogTable } from "../components/LogTable";
import { ConflictCard } from "../components/ConflictCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { usePolling } from "../hooks/usePolling";

const LEVELS = ["all", "info", "warn", "error"] as const;

type Banner = { kind: "success" | "warn" | "error"; text: string };

const BANNER_STYLE: Record<Banner["kind"], { bg: string; fg: string }> = {
  success: { bg: "#dcfce7", fg: "#166534" },
  warn: { bg: "#fef3c7", fg: "#92400e" },
  error: { bg: "#fee2e2", fg: "#991b1b" },
};

export function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [olderRows, setOlderRows] = useState<SyncLogRow[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [pendingResolve, setPendingResolve] = useState<{ refName: string; winner: ConflictWinner } | null>(null);

  const { data: conn, refresh: refreshConn } = usePolling(() => api.getConnection(id!), 10_000, [id]);
  const { data: logsPage, refresh: refreshLogs } = usePolling(
    () => api.listLogs(id!, { limit: 50, level: level === "all" ? undefined : level }),
    5_000,
    [id, level],
  );
  const { data: conflicts, refresh: refreshConflicts } = usePolling(() => api.listConflicts(id!), 10_000, [id]);

  useEffect(() => {
    setOlderRows([]);
    setHasMoreOlder(true);
  }, [level]);

  if (!conn) return <div style={{ padding: 24 }}>Loading…</div>;

  const handleSyncNow = async () => {
    setSyncing(true);
    setBanner(null);
    try {
      const result = await api.syncNow(conn.id);
      const changed = result.plan.filter((p) => p.decision.kind !== "noop" && p.decision.kind !== "azure-ahead");
      const conflictCount = result.plan.filter((p) => p.decision.kind === "azure-ahead").length;
      if (result.status === "error") {
        setBanner({ kind: "error", text: result.error ?? "Sync failed - see the logs below." });
      } else if (conflictCount > 0) {
        setBanner({
          kind: "warn",
          text: `Synced, but Azure DevOps has changes on ${conflictCount} ref${conflictCount === 1 ? "" : "s"} that need${conflictCount === 1 ? "s" : ""} your decision below.`,
        });
      } else if (changed.length === 0) {
        setBanner({ kind: "success", text: "Already up to date - nothing to sync." });
      } else {
        setBanner({ kind: "success", text: `Synced successfully (${changed.length} ref${changed.length === 1 ? "" : "s"} updated).` });
      }
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Sync request failed." });
    } finally {
      setSyncing(false);
      await Promise.all([refreshConn(), refreshLogs(), refreshConflicts()]);
    }
  };

  const requestResolve = (refName: string, winner: ConflictWinner) => setPendingResolve({ refName, winner });

  const confirmResolve = async () => {
    if (!pendingResolve) return;
    const { refName, winner } = pendingResolve;
    setPendingResolve(null);
    setResolving(refName);
    setBanner(null);
    try {
      await api.resolveConflict(conn.id, refName, winner);
      setBanner({
        kind: "success",
        text:
          winner === "azure"
            ? "Resolved - pulled Azure DevOps's changes into GitHub."
            : "Resolved - discarded Azure DevOps's changes, GitHub's version stands.",
      });
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Failed to resolve conflict." });
    } finally {
      setResolving(null);
      await Promise.all([refreshConn(), refreshLogs(), refreshConflicts()]);
    }
  };

  const liveRows = logsPage?.items ?? [];
  const seenIds = new Set(liveRows.map((r) => r.id));
  const rows = [...liveRows, ...olderRows.filter((r) => !seenIds.has(r.id))].sort((a, b) => b.id - a.id);
  const oldestLoadedId = rows.length > 0 ? rows[rows.length - 1].id : undefined;

  const loadOlder = async () => {
    if (!oldestLoadedId) return;
    setLoadingOlder(true);
    try {
      const more = await api.listLogs(conn.id, {
        cursor: oldestLoadedId,
        limit: 50,
        level: level === "all" ? undefined : level,
      });
      setOlderRows((prev) => [...prev, ...more.items]);
      setHasMoreOlder(more.nextCursor !== null);
    } finally {
      setLoadingOlder(false);
    }
  };

  const canLoadOlder = hasMoreOlder && rows.length > 0;

  return (
    <div style={{ padding: 24 }}>
      <Link to="/">&larr; Back</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <h1 style={{ margin: 0 }}>{conn.name}</h1>
        <StatusBadge status={conn.status} title={conn.statusDetail ?? undefined} />
      </div>
      <p style={{ color: "#6b7280" }}>
        Last synced: {conn.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleString() : "never"}
      </p>
      {conn.statusDetail && <p style={{ fontSize: 13, color: "#374151" }}>{conn.statusDetail}</p>}

      {banner && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            borderRadius: 4,
            background: BANNER_STYLE[banner.kind].bg,
            color: BANNER_STYLE[banner.kind].fg,
          }}
        >
          {banner.text}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={handleSyncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button onClick={() => navigate(`/connections/${conn.id}/edit`)}>Edit</button>
      </div>

      {(conflicts ?? []).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3>Needs your decision</h3>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: -4 }}>
            GitHub always pushes to Azure DevOps automatically - but Azure DevOps has changes on these refs that
            GitHub doesn't have, so nothing has been touched. Choose whether to pull them into GitHub, or discard
            them and keep GitHub's version.
          </p>
          {(conflicts ?? []).map((c) => (
            <ConflictCard
              key={c.refName}
              conflict={c}
              busy={resolving === c.refName}
              onResolve={(winner) => requestResolve(c.refName, winner)}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Logs</h3>
        <select value={level} onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <LogTable rows={rows} />

      {canLoadOlder && (
        <button onClick={loadOlder} disabled={loadingOlder} style={{ marginTop: 8 }}>
          {loadingOlder ? "Loading…" : "Load older"}
        </button>
      )}

      <ConfirmDialog
        open={pendingResolve !== null}
        title="Force-push this decision?"
        message={(() => {
          if (!pendingResolve) return "";
          const shortName = pendingResolve.refName.replace(/^refs\/(heads|tags)\//, "");
          const conflict = (conflicts ?? []).find((c) => c.refName === pendingResolve.refName);
          if (pendingResolve.winner === "azure") {
            return `This overwrites GitHub's "${shortName}" with Azure DevOps's version. This cannot be undone automatically.`;
          }
          return conflict?.githubSha
            ? `This overwrites Azure DevOps's "${shortName}" with GitHub's version. This cannot be undone automatically.`
            : `GitHub has no "${shortName}" - this deletes it from Azure DevOps too. This cannot be undone automatically.`;
        })()}
        confirmLabel="Force-push"
        onCancel={() => setPendingResolve(null)}
        onConfirm={confirmResolve}
      />
    </div>
  );
}
