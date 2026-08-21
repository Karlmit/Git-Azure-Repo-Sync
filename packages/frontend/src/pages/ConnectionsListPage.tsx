import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ConnectionPublic } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConnections } from "../hooks/useConnections";

type ActionMessage = { kind: "success" | "warn" | "error"; text: string };

const BANNER_STYLE: Record<ActionMessage["kind"], { bg: string; fg: string }> = {
  success: { bg: "#dcfce7", fg: "#166534" },
  warn: { bg: "#fef3c7", fg: "#92400e" },
  error: { bg: "#fee2e2", fg: "#991b1b" },
};

export function ConnectionsListPage() {
  const { data: connections, refresh } = useConnections();
  const [pendingDelete, setPendingDelete] = useState<ConnectionPublic | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const withBusy = async (id: string, action: () => Promise<unknown>, successText: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage({ kind: "success", text: successText });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Action failed." });
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncNow = async (conn: ConnectionPublic) => {
    setBusyId(conn.id);
    setMessage(null);
    try {
      const result = await api.syncNow(conn.id);
      await refresh();
      const changed = result.plan.filter((p) => p.decision.kind !== "noop" && p.decision.kind !== "needs-approval");
      const conflictCount = result.plan.filter((p) => p.decision.kind === "needs-approval").length;
      if (result.status === "error") {
        setMessage({ kind: "error", text: `${conn.name}: sync failed - ${result.error ?? "see its logs"}` });
      } else if (conflictCount > 0) {
        setMessage({
          kind: "warn",
          text: `${conn.name}: Azure DevOps has changes on ${conflictCount} ref${conflictCount === 1 ? "" : "s"} - open the connection to decide.`,
        });
      } else if (changed.length === 0) {
        setMessage({ kind: "success", text: `${conn.name}: already up to date.` });
      } else {
        setMessage({ kind: "success", text: `${conn.name}: synced (${changed.length} ref${changed.length === 1 ? "" : "s"} updated).` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Sync request failed." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1>Connections</h1>
        <Link to="/connections/new">
          <button>+ Add Connection</button>
        </Link>
      </div>

      {message && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 16,
            borderRadius: 4,
            background: BANNER_STYLE[message.kind].bg,
            color: BANNER_STYLE[message.kind].fg,
          }}
        >
          {message.text}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Last Synced</th>
            <th style={{ padding: 8 }}>Interval</th>
            <th style={{ padding: 8 }}>Enabled</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {(connections ?? []).map((conn) => (
            <tr key={conn.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: 8 }}>
                <Link to={`/connections/${conn.id}`}>{conn.name}</Link>
              </td>
              <td style={{ padding: 8 }}>
                <StatusBadge status={conn.status} title={conn.statusDetail ?? undefined} />
              </td>
              <td style={{ padding: 8, fontSize: 13, color: "#6b7280" }}>
                {conn.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleString() : "never"}
              </td>
              <td style={{ padding: 8 }}>{conn.pollIntervalMinutes}m</td>
              <td style={{ padding: 8 }}>{conn.enabled ? "yes" : "paused"}</td>
              <td style={{ padding: 8, display: "flex", gap: 6 }}>
                <button disabled={busyId === conn.id} onClick={() => handleSyncNow(conn)}>
                  {busyId === conn.id ? "Syncing…" : "Sync now"}
                </button>
                {conn.enabled ? (
                  <button
                    disabled={busyId === conn.id}
                    onClick={() => withBusy(conn.id, () => api.pauseConnection(conn.id), `${conn.name} paused.`)}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    disabled={busyId === conn.id}
                    onClick={() => withBusy(conn.id, () => api.resumeConnection(conn.id), `${conn.name} resumed.`)}
                  >
                    Resume
                  </button>
                )}
                <Link to={`/connections/${conn.id}/edit`}>
                  <button>Edit</button>
                </Link>
                <button onClick={() => setPendingDelete(conn)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(connections ?? []).length === 0 && <p style={{ color: "#6b7280", marginTop: 16 }}>No connections yet.</p>}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete connection"
        message={`Delete "${pendingDelete?.name}"? This removes its sync history and local mirror. It does not delete anything on GitHub or Azure DevOps.`}
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const name = pendingDelete.name;
          try {
            await api.deleteConnection(pendingDelete.id);
            setMessage({ kind: "success", text: `${name} deleted.` });
          } catch (err) {
            setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to delete connection." });
          } finally {
            setPendingDelete(null);
            await refresh();
          }
        }}
      />
    </div>
  );
}
