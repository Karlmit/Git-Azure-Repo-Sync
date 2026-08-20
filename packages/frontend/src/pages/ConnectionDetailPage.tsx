import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type SyncLogRow } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { LogTable } from "../components/LogTable";
import { usePolling } from "../hooks/usePolling";

const LEVELS = ["all", "info", "warn", "error"] as const;

export function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [olderRows, setOlderRows] = useState<SyncLogRow[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data: conn, refresh: refreshConn } = usePolling(() => api.getConnection(id!), 10_000, [id]);
  const { data: logsPage, refresh: refreshLogs } = usePolling(
    () => api.listLogs(id!, { limit: 50, level: level === "all" ? undefined : level }),
    5_000,
    [id, level],
  );

  useEffect(() => {
    setOlderRows([]);
    setHasMoreOlder(true);
  }, [level]);

  if (!conn) return <div style={{ padding: 24 }}>Loading…</div>;

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await api.syncNow(conn.id);
      await Promise.all([refreshConn(), refreshLogs()]);
    } finally {
      setSyncing(false);
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

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={handleSyncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button onClick={() => navigate(`/connections/${conn.id}/edit`)}>Edit</button>
      </div>

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
    </div>
  );
}
