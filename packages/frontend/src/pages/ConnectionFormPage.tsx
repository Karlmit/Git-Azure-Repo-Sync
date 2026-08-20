import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type TestConnectionResult } from "../api/client";
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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

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

  const canTest =
    form.githubUrl.trim() !== "" &&
    form.azureOrg.trim() !== "" &&
    form.azureProject.trim() !== "" &&
    form.azureRepo.trim() !== "" &&
    (isEdit || (form.githubPat.trim() !== "" && form.azurePat.trim() !== ""));

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result =
        isEdit && id
          ? await api.testExistingConnection(id, {
              ...(form.githubPat ? { githubPat: form.githubPat } : {}),
              ...(form.azurePat ? { azurePat: form.azurePat } : {}),
            })
          : await api.testNewConnection({
              githubUrl: form.githubUrl,
              githubPat: form.githubPat,
              azureOrg: form.azureOrg,
              azureProject: form.azureProject,
              azureRepo: form.azureRepo,
              azurePat: form.azurePat,
            });
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Test request failed.");
    } finally {
      setTesting(false);
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

        <div>
          <button type="button" onClick={handleTestConnection} disabled={!canTest || testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          {!canTest && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#6b7280" }}>
              Fill in the URL/org/project/repo{!isEdit && " and both PATs"} first.
            </span>
          )}
          {testError && <p style={{ color: "#b91c1c", fontSize: 13 }}>{testError}</p>}
          {testResult && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span style={{ color: testResult.github.ok ? "#166534" : "#b91c1c" }}>
                GitHub: {testResult.github.ok ? "✓" : "✗"} {testResult.github.message}
              </span>
              <span style={{ color: testResult.azure.ok ? "#166534" : "#b91c1c" }}>
                Azure DevOps: {testResult.azure.ok ? "✓" : "✗"} {testResult.azure.message}
              </span>
            </div>
          )}
        </div>

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
        title="Heads up: how syncing works"
        message="GitHub is treated as the source of truth: changes on GitHub push to Azure DevOps automatically. If Azure DevOps ever has changes GitHub doesn't (someone worked there directly), sync pauses on that ref and asks you to choose - pull those changes into GitHub, or discard them - nothing is pushed automatically in that case. Understood?"
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
