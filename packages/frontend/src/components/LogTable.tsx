import { useState } from "react";
import type { SyncLogRow } from "../api/client";

const LEVEL_COLOR: Record<string, string> = {
  debug: "#6b7280",
  info: "#1f2937",
  warn: "#b45309",
  error: "#b91c1c",
};

function Row({ row }: { row: SyncLogRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = row.details && Object.keys(row.details).length > 0;

  return (
    <>
      <tr
        onClick={() => hasDetails && setExpanded((e) => !e)}
        style={{ cursor: hasDetails ? "pointer" : "default", borderBottom: "1px solid #f3f4f6" }}
      >
        <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12 }}>
          {new Date(row.ts).toLocaleString()}
        </td>
        <td style={{ padding: "6px 8px", color: LEVEL_COLOR[row.level] ?? "#111827", fontWeight: 600, fontSize: 12 }}>
          {row.level.toUpperCase()}
        </td>
        <td style={{ padding: "6px 8px" }}>{row.message}</td>
      </tr>
      {expanded && hasDetails && (
        <tr>
          <td colSpan={3} style={{ padding: "6px 8px", background: "#f9fafb" }}>
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(row.details, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

export function LogTable({ rows }: { rows: SyncLogRow[] }) {
  if (rows.length === 0) {
    return <p style={{ color: "#6b7280" }}>No log entries yet.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
          <th style={{ padding: "6px 8px" }}>Time</th>
          <th style={{ padding: "6px 8px" }}>Level</th>
          <th style={{ padding: "6px 8px" }}>Message</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}
