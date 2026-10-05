import { useCallback, useEffect, useState } from "react";
import { ProjectsTab } from "./ProjectsTab";
import { SettingsTab } from "./SettingsTab";
import type { Settings } from "../shared/types";

type Tab = "projects" | "settings";

export function Popup(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("projects");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const res = (await chrome.runtime.sendMessage({ type: "GET_SETTINGS" })) as
      | { ok: true; data: Settings }
      | { ok: false; error: string };
    if (res.ok) {
      setSettings(res.data);
      setSetupError(null);
    } else {
      setSetupError(res.error);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return (
    <main className="popup">
      <header className="header">
        <div className="brand-row">
          <div className="brand-title">
            <span className="brand-logo-dot" />
            <span>Timestripe Enhancement</span>
          </div>
          <span className="brand-badge">v0.1.0</span>
        </div>
        <nav className="tabs-nav">
          <button
            type="button"
            className={tab === "projects" ? "tab-btn active" : "tab-btn"}
            onClick={() => setTab("projects")}
          >
            Projects
          </button>
          <button
            type="button"
            className={tab === "settings" ? "tab-btn active" : "tab-btn"}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
        </nav>
      </header>

      {setupError && (
        <div style={{ padding: "12px 16px 0" }}>
          <div className="status-pill warning">⚠️ Setup needed: {setupError}</div>
        </div>
      )}

      {tab === "projects" && settings?.activeSpaceId && <ProjectsTab />}
      {tab === "projects" && !settings?.activeSpaceId && (
        <div style={{ padding: "28px 16px", textAlign: "center" }}>
          <p className="desc-text" style={{ marginBottom: "12px" }}>
            Add your Timestripe API key and select an active space to manage projects.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setTab("settings")}>
            Go to Settings
          </button>
        </div>
      )}
      {tab === "settings" && <SettingsTab settings={settings} onSettingsChanged={() => void loadSettings()} />}
    </main>
  );
}
