import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { NavBar } from "./components/NavBar";
import { LoginPage } from "./pages/LoginPage";
import { ConnectionsListPage } from "./pages/ConnectionsListPage";
import { ConnectionFormPage } from "./pages/ConnectionFormPage";
import { ConnectionDetailPage } from "./pages/ConnectionDetailPage";

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
    api
      .version()
      .then((v) => setVersion(v.version))
      .catch(() => setVersion(null));
  }, []);

  if (authenticated === null) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  if (!authenticated) {
    return <LoginPage onLoggedIn={() => setAuthenticated(true)} />;
  }

  return (
    <BrowserRouter>
      <NavBar version={version} onLogout={() => setAuthenticated(false)} />
      <Routes>
        <Route path="/" element={<ConnectionsListPage />} />
        <Route path="/connections/new" element={<ConnectionFormPage />} />
        <Route path="/connections/:id" element={<ConnectionDetailPage />} />
        <Route path="/connections/:id/edit" element={<ConnectionFormPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
