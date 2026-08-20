import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface FormState {
  name: string;
  githubUrl: string;
  azureOrg: string;
  azureProject: string;
  azureRepo: string;
  githubPat: string;
  azurePat: string;
  branchScope: "all" | "explicit";
  branchListText: string;
  syncTags: boolean;
  pollIntervalSeconds: number;
}

const EMPTY: FormState = {
  name: "",
  githubUrl: "",
  azureOrg: "",
  azureProject: "",
  azureRepo: "",
  githubPat: "",
  azurePat: "",
  branchScope: "all",
  branchListText: "",
  syncTags: true,
  pollIntervalSeconds: 120,
};

export function ConnectionFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [githubPatSet, setGithubPatSet] = useState(false);
  const [azurePatSet, setAzurePatSet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmForcePushOpen, setConfirmForcePushOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getConnection(id).then((conn) => {
      setForm({
        name: conn.name,
        githubUrl: conn.githubUrl,
        azureOrg: conn.azureOrg,
        azureProject: conn.azureProject,
        azureRepo: conn.azureRepo,
        githubPat: "",
        azurePat: "",
        branchScope: conn.branchScope,
        branchListText: conn.branchList.join("\n"),
        syncTags: conn.syncTags,
        pollIntervalSeconds: conn.pollIntervalSeconds,
      });
      setGithubPatSet(conn.githubPatSet);
      setAzurePatSet(conn.azurePatSet);
    });
  }, [id]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const branchList = form.branchListText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (isEdit && id) {
        await api.updateConnection(id, {
          name: form.name,
          githubUrl: form.githubUrl,
          azureOrg: form.azureOrg,
          azureProject: form.azureProject,
          azureRepo: form.azureRepo,
          ...(form.githubPat ? { githubPat: form.githubPat } : {}),
          ...(form.azurePat ? { azurePat: form.azurePat } : {}),
          branchScope: form.branchScope,
          branchList,
          syncTags: form.syncTags,
          pollIntervalSeconds: form.pollIntervalSeconds,
        });
      } else {
        await api.createConnection({
          name: form.name,
          githubUrl: form.githubUrl,
          azureOrg: form.azureOrg,
          azureProject: form.azureProject,
          azureRepo: form.azureRepo,
          githubPat: form.githubPat,
          azurePat: form.azurePat,
          branchScope: form.branchScope,
          branchList,
          syncTags: form.syncTags,
          pollIntervalSeconds: form.pollIntervalSeconds,
        });
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit) {
      setConfirmForcePushOpen(true);
    } else {
      submit();
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h1>{isEdit ? "Edit connection" : "Add connection"}</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>

        <label>
          GitHub repo URL
          <input
            placeholder="https://github.com/org/repo.git"
            value={form.githubUrl}
            onChange={(e) => setForm({ ...form, githubUrl: e.target.value })}
            required
          />
        </label>

        <label>
          GitHub PAT {githubPatSet && <em style={{ fontSize: 12 }}>(leave blank to keep existing)</em>}
          <input
            type="password"
            value={form.githubPat}
            onChange={(e) => setForm({ ...form, githubPat: e.target.value })}
            required={!isEdit}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ flex: 1 }}>
            Azure org
            <input value={form.azureOrg} onChange={(e) => setForm({ ...form, azureOrg: e.target.value })} required />
          </label>
          <label style={{ flex: 1 }}>
            Azure project
            <input
              value={form.azureProject}
              onChange={(e) => setForm({ ...form, azureProject: e.target.value })}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            Azure repo
            <input value={form.azureRepo} onChange={(e) => setForm({ ...form, azureRepo: e.target.value })} required />
          </label>
        </div>

        <label>
          Azure DevOps PAT {azurePatSet && <em style={{ fontSize: 12 }}>(leave blank to keep existing)</em>}
          <input
            type="password"
            value={form.azurePat}
            onChange={(e) => setForm({ ...form, azurePat: e.target.value })}
            required={!isEdit}
          />
        </label>

        <fieldset>
          <legend>Branch scope</legend>
          <label>
            <input
              type="radio"
              checked={form.branchScope === "all"}
              onChange={() => setForm({ ...form, branchScope: "all" })}
            />
            All branches
          </label>
          <label style={{ marginLeft: 12 }}>
            <input
              type="radio"
              checked={form.branchScope === "explicit"}
              onChange={() => setForm({ ...form, branchScope: "explicit" })}
            />
            Explicit list
          </label>
          {form.branchScope === "explicit" && (
            <textarea
              placeholder="one branch name per line"
              value={form.branchListText}
              onChange={(e) => setForm({ ...form, branchListText: e.target.value })}
              rows={4}
              style={{ width: "100%", marginTop: 8 }}
            />
          )}
        </fieldset>

        <label>
          <input
            type="checkbox"
            checked={form.syncTags}
            onChange={(e) => setForm({ ...form, syncTags: e.target.checked })}
          />
          Sync tags
        </label>

        <label>
          Poll interval (seconds, min 30)
          <input
            type="number"
            min={30}
            value={form.pollIntervalSeconds}
            onChange={(e) => setForm({ ...form, pollIntervalSeconds: Number(e.target.value) })}
          />
        </label>

        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={submitting}>
            {isEdit ? "Save" : "Create"}
          </button>
          <button type="button" onClick={() => navigate("/")}>
            Cancel
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmForcePushOpen}
        title="Heads up: this can force-push"
        message="If the two repos ever diverge on the same branch, this tool resolves it by force-pushing whichever side has the most recent commit over the other side, overwriting history there. Understood?"
        confirmLabel="Yes, create connection"
        onCancel={() => setConfirmForcePushOpen(false)}
        onConfirm={() => {
          setConfirmForcePushOpen(false);
          submit();
        }}
      />
    </div>
  );
}
