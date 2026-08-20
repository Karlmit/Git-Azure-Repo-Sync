export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div style={{ background: "white", borderRadius: 8, padding: 24, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p style={{ color: "#374151" }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onConfirm} style={{ background: "#dc2626", color: "white", border: "none", padding: "6px 12px", borderRadius: 4 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
