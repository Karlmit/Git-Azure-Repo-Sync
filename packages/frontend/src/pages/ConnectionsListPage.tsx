import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ConnectionPublic } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConnections } from "../hooks/useConnections";

export function ConnectionsListPage() {
  const { data: connections, refresh } = useConnections();
  const [pendingDelete, setPendingDelete] = useState<ConnectionPublic | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const withBusy = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await action();
      await refresh();
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
              <td style={{ padding: 8 }}>{conn.pollIntervalSeconds}s</td>
              <td style={{ padding: 8 }}>{conn.enabled ? "yes" : "paused"}</td>
              <td style={{ padding: 8, display: "flex", gap: 6 }}>
                <button disabled={busyId === conn.id} onClick={() => withBusy(conn.id, () => api.syncNow(conn.id))}>
                  Sync now
                </button>
                {conn.enabled ? (
                  <button disabled={busyId === conn.id} onClick={() => withBusy(conn.id, () => api.pauseConnection(conn.id))}>
                    Pause
                  </button>
                ) : (
                  <button disabled={busyId === conn.id} onClick={() => withBusy(conn.id, () => api.resumeConnection(conn.id))}>
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
          await api.deleteConnection(pendingDelete.id);
          setPendingDelete(null);
          await refresh();
        }}
      />
    </div>
  );
}
