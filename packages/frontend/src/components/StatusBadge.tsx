import type { ConnectionStatus } from "../api/client";

const STYLES: Record<ConnectionStatus, { label: string; bg: string; fg: string }> = {
  idle: { label: "Idle", bg: "#e5e7eb", fg: "#374151" },
  syncing: { label: "Syncing…", bg: "#dbeafe", fg: "#1e40af" },
  ok: { label: "OK", bg: "#dcfce7", fg: "#166534" },
  conflict: { label: "Conflict", bg: "#fef3c7", fg: "#92400e" },
  error: { label: "Error", bg: "#fee2e2", fg: "#991b1b" },
};

export function StatusBadge({ status, title }: { status: ConnectionStatus; title?: string }) {
  const style = STYLES[status];
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: style.bg,
        color: style.fg,
      }}
    >
      {style.label}
    </span>
  );
}
