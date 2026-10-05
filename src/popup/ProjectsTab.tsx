import { useCallback, useEffect, useState } from "react";
import type { AssignmentInfo, Project, TSSpace, ViewState } from "../shared/types";
import { ColorPicker } from "./ColorPicker";

async function callBg<T>(message: unknown): Promise<T | null> {
  const res = (await chrome.runtime.sendMessage(message)) as { ok: true; data: T } | { ok: false; error: string };
  if (!res.ok) {
    console.warn("[TSE popup]", res.error);
    return null;
  }
  return res.data;
}

const QUICK_COLORS = [
  "#7C5CFF", "#00A8FF", "#00E676", "#FFEA00",
  "#FF9100", "#FF3D00", "#F48FB1", "#FFFFFF",
];

export function ProjectsTab(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [spaces, setSpaces] = useState<TSSpace[]>([]);
  const [newProjectScope, setNewProjectScope] = useState<string>("global");
  const [assignments, setAssignments] = useState<Record<string, AssignmentInfo> | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(QUICK_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [search, setSearch] = useState("");
  const [deletingProject, setDeletingProject] = useState<{ id: string; name: string; taskCount: number } | null>(null);

  const load = useCallback(async () => {
    const [data, view, spList] = await Promise.all([
      callBg<Project[]>({ type: "GET_PROJECTS" }),
      callBg<ViewState>({ type: "GET_VIEW_STATE" }),
      callBg<TSSpace[]>({ type: "LIST_SPACES" }),
    ]);
    if (data) setProjects(data);
    if (view) setAssignments(view.assignments);
    if (spList) setSpaces(spList);
  }, []);

  useEffect(() => {
    void load();
    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") void load();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [load]);

  const counts = new Map<string, number>();
  if (assignments) {
    for (const a of Object.values(assignments)) {
      counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1);
    }
  }

  const create = useCallback(async () => {
    if (!name.trim()) return;
    await callBg<Project>({
      type: "CREATE_PROJECT",
      name: name.trim(),
      color,
      spaceId: newProjectScope === "global" ? null : newProjectScope,
    });
    setName("");
    await load();
  }, [name, color, newProjectScope, load]);

  const updateScope = useCallback(
    async (projectId: string, newScope: string | null) => {
      const current = projects.find((p) => p.id === projectId);
      if (!current) return;
      await callBg<Project>({
        type: "UPDATE_PROJECT",
        project: { ...current, spaceId: newScope },
      });
      await load();
    },
    [projects, load],
  );

  const rename = useCallback(
    async (projectId: string) => {
      if (!editName.trim()) return;
      const current = projects.find((p) => p.id === projectId);
      if (!current) return;
      await callBg<Project>({ type: "UPDATE_PROJECT", project: { ...current, name: editName.trim() } });
      setEditingId(null);
      await load();
    },
    [editName, projects, load],
  );

  const recolor = useCallback(
    async (projectId: string, newColor: string) => {
      const current = projects.find((p) => p.id === projectId);
      if (!current) return;
      await callBg<Project>({ type: "UPDATE_PROJECT", project: { ...current, color: newColor } });
      await load();
    },
    [projects, load],
  );

  const confirmDelete = useCallback(async () => {
    if (!deletingProject) return;
    await callBg({ type: "DELETE_PROJECT", projectId: deletingProject.id });
    setDeletingProject(null);
    await load();
  }, [deletingProject, load]);

  const filteredProjects = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase().trim()))
    : projects;

  return (
    <div className="content-body" style={{ position: "relative" }}>
      {/* Existing Projects Card */}
      <div className="section-card">
        <div className="section-header">
          <span className="section-title">Projects ({projects.length})</span>
          {projects.length > 3 && (
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "110px", padding: "3px 7px", fontSize: "11.5px", margin: 0 }}
            />
          )}
        </div>

        {projects.length === 0 ? (
          <p className="desc-text">
            No projects yet. Create one below to organize and color code your goals.
          </p>
        ) : (
          <div className="project-items-list">
            {filteredProjects.map((p) => (
              <div key={p.id} className="project-item-card">
                <span className="project-jewel-dot" style={{ background: p.color }} />
                {editingId === p.id ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      autoFocus
                      style={{ margin: 0, padding: "4px 8px", flex: 1 }}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(p.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "4px 9px", fontSize: "11.5px" }}
                      onClick={() => void rename(p.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      title="Cancel"
                      onClick={() => setEditingId(null)}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="project-card-name" dir="auto" title={p.name}>
                      {p.name}
                    </span>
                    <select
                      className={p.spaceId ? "project-scope-select scope-specific" : "project-scope-select"}
                      value={p.spaceId ?? "global"}
                      onChange={(e) => void updateScope(p.id, e.target.value === "global" ? null : e.target.value)}
                      title={`Scope: ${!p.spaceId || p.spaceId === "global" ? "Global (All Spaces)" : (spaces.find((s) => s.id === p.spaceId)?.name ?? p.spaceId)}`}
                    >
                      <option value="global">🌐 Global</option>
                      {spaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {counts.has(p.id) && (
                      <span className="project-task-pill">{counts.get(p.id)} tasks</span>
                    )}
                    <div className="project-actions">
                      <ColorPicker value={p.color} onChange={(c) => void recolor(p.id, c)} title="Recolor" />
                      <button
                        type="button"
                        className="btn-icon"
                        title="Rename"
                        onClick={() => {
                          setEditingId(p.id);
                          setEditName(p.name);
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Delete"
                        onClick={() =>
                          setDeletingProject({ id: p.id, name: p.name, taskCount: counts.get(p.id) ?? 0 })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add New Project Card */}
      <div className="add-project-card">
        <span className="section-title">New Project</span>
        <div className="form-group">
          <input
            type="text"
            placeholder="Project name (e.g. Work, Study, Health)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) void create();
            }}
          />
        </div>

        {/* Scope selector for new project */}
        <div className="new-project-scope-row">
          <span className="scope-label">Scope:</span>
          <button
            type="button"
            className={newProjectScope === "global" ? "scope-chip active" : "scope-chip"}
            onClick={() => setNewProjectScope("global")}
          >
            🌐 Global
          </button>
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              className={newProjectScope === s.id ? "scope-chip active" : "scope-chip"}
              onClick={() => setNewProjectScope(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="swatches-row">
          {QUICK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === color ? "swatch-btn selected" : "swatch-btn"}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
          <ColorPicker value={color} onChange={setColor} direction="up" title="Full color palette" />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "4px" }}
          onClick={() => void create()}
          disabled={!name.trim()}
        >
          Add Project
        </button>
      </div>

      {/* Custom Confirmation Modal */}
      {deletingProject && (
        <div className="popup-confirm-overlay" onClick={() => setDeletingProject(null)}>
          <div className="popup-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="popup-confirm-title">
              <span>⚠️</span>
              <span>Delete Project?</span>
            </div>
            <p className="popup-confirm-desc">
              Are you sure you want to delete <strong style={{ color: "#fff" }}>"{deletingProject.name}"</strong>?
              {deletingProject.taskCount > 0 && (
                <>
                  <br />
                  <span style={{ color: "#fbbf24" }}>
                    {deletingProject.taskCount} linked tasks will lose their project assignment.
                  </span>
                </>
              )}
            </p>
            <div className="popup-confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeletingProject(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmDelete()}
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
