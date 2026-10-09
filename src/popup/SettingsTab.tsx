import { useCallback, useEffect, useState } from "react";
import type {
  GoalTemplate,
  Project,
  Settings,
  TaskProjectLink,
  TaskTextConfig,
  TSSpace,
} from "../shared/types";
import type { BackupPayload } from "../shared/messages";

async function callBg<T>(message: unknown): Promise<T | null> {
  const res = (await chrome.runtime.sendMessage(message)) as { ok: true; data: T } | { ok: false; error: string };
  if (!res.ok) {
    console.warn("[TSE popup]", res.error);
    return null;
  }
  return res.data;
}

function normalizeBackupPayload(raw: unknown): BackupPayload {
  if (Array.isArray(raw)) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      spaceId: "global",
      data: {
        projects: raw as Project[],
        taskProjectLinks: {},
        taskColorOverrides: {},
        templates: [],
        taskTextConfigs: {},
      },
    };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.data && typeof obj.data === "object") {
      return raw as BackupPayload;
    }
    if (obj.projects || obj.templates || obj.taskProjectLinks || obj.taskColorOverrides || obj.taskTextConfigs) {
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        spaceId: "global",
        data: {
          projects: (obj.projects as Project[]) ?? [],
          templates: (obj.templates as GoalTemplate[]) ?? [],
          taskProjectLinks: (obj.taskProjectLinks as Record<string, TaskProjectLink>) ?? {},
          taskColorOverrides: (obj.taskColorOverrides as Record<string, string>) ?? {},
          taskTextConfigs: (obj.taskTextConfigs as Record<string, TaskTextConfig>) ?? {},
        },
      };
    }
  }
  throw new Error("Invalid JSON: Missing projects, templates or backup data structure.");
}

interface Props {
  settings: Settings | null;
  onSettingsChanged: () => void;
}

export function SettingsTab({ settings, onSettingsChanged }: Props): React.JSX.Element {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [spaces, setSpaces] = useState<TSSpace[] | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedJson, setPastedJson] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "overwrite">("merge");
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    void chrome.storage.local.get("apiKey").then(({ apiKey: saved }) => {
      if (typeof saved === "string") setApiKey(saved);
    });
  }, []);

  const loadSpaces = useCallback(async () => {
    const data = await callBg<TSSpace[]>({ type: "LIST_SPACES" });
    setSpaces(data ?? []);
  }, []);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  const saveKey = useCallback(async () => {
    await callBg({ type: "SAVE_API_KEY", apiKey });
    setTestResult("API Key saved successfully.");
    setTestOk(true);
    await loadSpaces();
    onSettingsChanged();
  }, [apiKey, loadSpaces, onSettingsChanged]);

  const testKey = useCallback(async () => {
    await callBg({ type: "SAVE_API_KEY", apiKey });
    const res = await callBg<{ status: number; body: string }>({ type: "TEST_API" });
    if (!res) return;
    setTestOk(res.status === 200);
    setTestResult(res.status === 200 ? `Connected: ${res.body}` : `Error HTTP ${res.status}: ${res.body}`);
  }, [apiKey]);

  const setActiveSpace = useCallback(
    async (spaceId: string) => {
      await callBg({ type: "SET_ACTIVE_SPACE", spaceId });
      onSettingsChanged();
    },
    [onSettingsChanged],
  );

  const patchSettings = useCallback(
    async (patch: Partial<Settings>) => {
      await callBg({ type: "SET_SETTINGS", patch });
      onSettingsChanged();
    },
    [onSettingsChanged],
  );

  const exportBackup = useCallback(async () => {
    const res = await callBg<BackupPayload>({ type: "EXPORT_BACKUP" });
    if (!res) {
      setBackupStatus("Error: Could not retrieve backup data.");
      return;
    }
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timestripe-backup-${(res.spaceId ?? "space").slice(0, 8)}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus("Backup exported successfully.");
  }, []);

  const copyJsonBackup = useCallback(async () => {
    const res = await callBg<BackupPayload>({ type: "EXPORT_BACKUP" });
    if (!res) {
      setBackupStatus("Error: Could not retrieve backup data.");
      return;
    }
    const jsonStr = JSON.stringify(res, null, 2);
    try {
      await navigator.clipboard.writeText(jsonStr);
      setBackupStatus("📋 Backup JSON copied to clipboard!");
    } catch {
      setBackupStatus("Error: Clipboard write permission denied.");
    }
  }, []);

  const refreshJsonBackup = useCallback(async () => {
    setBackupStatus("🔄 Refreshing JSON and syncing with Timestripe…");
    const res = await callBg<{ backup: BackupPayload; prunedTotal: number; prunedLinks: number }>({
      type: "REFRESH_BACKUP",
    });
    if (!res) {
      setBackupStatus("Error: Could not refresh backup data.");
      return;
    }
    setBackupStatus(
      res.prunedTotal > 0
        ? `🔄 JSON refreshed! Pruned ${res.prunedTotal} deleted/orphaned items.`
        : "🔄 JSON refreshed! All projects and tasks are 100% up to date.",
    );
    onSettingsChanged();
  }, [onSettingsChanged]);

  const executePasteImport = useCallback(async () => {
    if (!pastedJson.trim()) return;
    try {
      setPasteError(null);
      const parsed = JSON.parse(pastedJson.trim()) as unknown;
      const payload = normalizeBackupPayload(parsed);

      const res = await callBg<{ restoredProjects: number; restoredTemplates: number }>({
        type: "IMPORT_BACKUP",
        payload,
        mode: importMode,
      });

      if (res) {
        setBackupStatus(`Restored ${res.restoredProjects} projects & ${res.restoredTemplates} templates.`);
        setShowPasteModal(false);
        setPastedJson("");
        onSettingsChanged();
      }
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err));
    }
  }, [pastedJson, importMode, onSettingsChanged]);

  const onImportFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = normalizeBackupPayload(JSON.parse(text));
        const confirmed = window.confirm(
          `Import backup containing ${payload.data.projects?.length ?? 0} projects and ${payload.data.templates?.length ?? 0} templates?\n\nClick OK to merge with current data, or Cancel to abort.`,
        );
        if (!confirmed) return;
        const res = await callBg<{ restoredProjects: number; restoredTemplates: number }>({
          type: "IMPORT_BACKUP",
          payload,
          mode: "merge",
        });
        if (res) {
          setBackupStatus(`Restored ${res.restoredProjects} projects & ${res.restoredTemplates} templates.`);
          onSettingsChanged();
        }
      } catch (err) {
        setBackupStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        e.target.value = "";
      }
    },
    [onSettingsChanged],
  );

  return (
    <div className="content-body">
      {/* API Key Connection Card */}
      <div className="section-card">
        <span className="section-title">API Authentication</span>
        <p className="desc-text">Bearer token from Timestripe Settings → API keys.</p>

        <div style={{ position: "relative" }}>
          <input
            type={showKey ? "text" : "password"}
            placeholder="Personal API Key"
            value={apiKey}
            style={{ paddingRight: "36px" }}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="btn-icon"
            style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)" }}
            onClick={() => setShowKey(!showKey)}
            title={showKey ? "Hide key" : "Show key"}
          >
            {showKey ? "👁️" : "🔒"}
          </button>
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => void saveKey()}>
            Save Key
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void testKey()}>
            Test Connection
          </button>
        </div>

        {testResult && (
          <div className={testOk ? "status-pill ok" : "status-pill warning"}>
            {testOk ? "✓ " : "⚠️ "} {testResult}
          </div>
        )}
      </div>

      {/* Active Space Selector */}
      <div className="section-card">
        <span className="section-title">Active Space</span>
        <p className="desc-text">Projects, colors and mappings are scoped to this space.</p>
        {spaces === null ? (
          <p className="desc-text">Save a valid API key to load your account spaces.</p>
        ) : spaces.length === 0 ? (
          <p className="desc-text">No spaces found on this account.</p>
        ) : (
          <div className="space-chips-group">
            <button
              type="button"
              className={settings?.activeSpaceId === "all" ? "space-chip active" : "space-chip"}
              onClick={() => void setActiveSpace("all")}
            >
              🌐 All Spaces
            </button>
            {spaces.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === settings?.activeSpaceId ? "space-chip active" : "space-chip"}
                onClick={() => void setActiveSpace(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Visual Color Mode Card */}
      <div className="section-card">
        <span className="section-title">Appearance & Indicators</span>
        <div className="mode-cards-grid">
          <div
            className={settings?.colorMode === "strip" ? "mode-option-card selected" : "mode-option-card"}
            onClick={() => void patchSettings({ colorMode: "strip" })}
          >
            <div className="mode-card-title">
              <span>Strip Mode</span>
              {settings?.colorMode === "strip" && <span>✓</span>}
            </div>
            <div className="mode-preview-bar strip" />
            <span style={{ fontSize: "11px", color: "#a1a1aa" }}>Subtle edge jewel</span>
          </div>

          <div
            className={settings?.colorMode === "full" ? "mode-option-card selected" : "mode-option-card"}
            onClick={() => void patchSettings({ colorMode: "full" })}
          >
            <div className="mode-card-title">
              <span>Full Color</span>
              {settings?.colorMode === "full" && <span>✓</span>}
            </div>
            <div className="mode-preview-bar full" />
            <span style={{ fontSize: "11px", color: "#a1a1aa" }}>Soft background tint</span>
          </div>
        </div>

        <label className="toggle-row">
          <span>Show project name badge on tasks</span>
          <input
            type="checkbox"
            checked={settings?.showProjectName ?? true}
            onChange={(e) => void patchSettings({ showProjectName: e.target.checked })}
          />
        </label>

        <label className="toggle-row" style={{ marginTop: "8px" }}>
          <span>Auto-complete parent goal when all subgoals are checked</span>
          <input
            type="checkbox"
            checked={settings?.autoCompleteParent ?? true}
            onChange={(e) => void patchSettings({ autoCompleteParent: e.target.checked })}
          />
        </label>
      </div>

      {/* Backup & Restore Card */}
      <div className="section-card">
        <span className="section-title">Backup & Restore</span>
        <p className="desc-text">
          Export your projects, colors, templates and configurations, or restore from a backup JSON file or text.
        </p>

        <div className="btn-row" style={{ flexWrap: "wrap", gap: "8px" }}>
          <button type="button" className="btn btn-secondary" onClick={() => void refreshJsonBackup()}>
            🔄 Refresh JSON
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void copyJsonBackup()}>
            📋 Copy JSON
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void exportBackup()}>
            Download .json
          </button>
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
            Upload File
            <input
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => void onImportFileSelected(e)}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setPasteError(null);
              setShowPasteModal(true);
            }}
          >
            📝 Paste JSON
          </button>
        </div>

        {backupStatus && <div className="status-pill ok" style={{ marginTop: "10px" }}>{backupStatus}</div>}
      </div>

      {/* Paste Backup JSON Modal */}
      {showPasteModal && (
        <div className="popup-confirm-overlay" onClick={() => setShowPasteModal(false)}>
          <div className="popup-confirm-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "340px" }}>
            <div className="popup-confirm-title">
              <span>📝</span>
              <span>Paste Backup JSON</span>
            </div>
            <p className="popup-confirm-desc" style={{ fontSize: "12px", margin: 0 }}>
              Paste your backup JSON directly. Supports full backup, spaces, or raw project lists.
            </p>

            <textarea
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              placeholder='Paste JSON here... e.g. { "data": { "projects": [...] } }'
              rows={6}
              style={{
                width: "100%",
                background: "#121214",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: "8px",
                padding: "8px",
                color: "#f4f4f5",
                fontSize: "11px",
                fontFamily: "monospace",
                resize: "vertical",
              }}
            />

            {pasteError && (
              <div style={{ color: "#f87171", fontSize: "11.5px", background: "rgba(239, 68, 68, 0.12)", padding: "6px 8px", borderRadius: "6px" }}>
                ⚠️ {pasteError}
              </div>
            )}

            <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "11.5px", color: "#a1a1aa" }}>
              <span>Mode:</span>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="pasteImportMode"
                  checked={importMode === "merge"}
                  onChange={() => setImportMode("merge")}
                />
                Merge
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="pasteImportMode"
                  checked={importMode === "overwrite"}
                  onChange={() => setImportMode("overwrite")}
                />
                Overwrite
              </label>
            </div>

            <div className="popup-confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowPasteModal(false);
                  setPastedJson("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pastedJson.trim()}
                onClick={() => void executePasteImport()}
              >
                Import Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
