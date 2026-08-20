import { Link } from "react-router-dom";
import { api } from "../api/client";

export function NavBar({ version, onLogout }: { version: string | null; onLogout: () => void }) {
  const handleLogout = async () => {
    await api.logout();
    onLogout();
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      <Link to="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: "none", color: "#111827" }}>
        gitsync
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {version && <span style={{ fontSize: 12, color: "#6b7280" }}>v{version}</span>}
        <button onClick={handleLogout}>Log out</button>
      </div>
    </header>
  );
}
