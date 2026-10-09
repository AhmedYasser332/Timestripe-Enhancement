import { useCallback, useEffect, useState } from "react";
import type { AssignmentInfo, Project, TSSpace, ViewState } from "../shared/types";
import { ColorPicker } from "./ColorPicker";
import {
  buildProjectTree,
  descendantsOf,
  effectiveColor,
  flattenTree,
  projectPath,
  reorderProjectTree,
  subtreeTaskCount,
  type ProjectTreeNode,
} from "../shared/project-tree";

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
  const [newProjectParentId, setNewProjectParentId] = useState<string>("");
  const [assignments, setAssignments] = useState<Record<string, AssignmentInfo> | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(QUICK_COLORS[0]);
  const [colorTouched, setColorTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [search, setSearch] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [movingProject, setMovingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<{
    id: string;
    name: string;
    directCount: number;
    subCount: number;
  } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<{ id: string; isTop: boolean } | null>(null);
  const [draggableId, setDraggableId] = useState<string | null>(null);

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
      spaceId: newProjectParentId ? undefined : (newProjectScope === "global" ? null : newProjectScope),
      parentId: newProjectParentId || null,
    });
    setName("");
    setColorTouched(false);
    await load();
  }, [name, color, newProjectScope, newProjectParentId, load]);

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

  const executeDelete = useCallback(
    async (mode: "cascade" | "promote") => {
      if (!deletingProject) return;
      await callBg({ type: "DELETE_PROJECT", projectId: deletingProject.id, mode });
      setDeletingProject(null);
      await load();
    },
    [deletingProject, load],
  );

  const moveProject = useCallback(
    async (project: Project, targetParentId: string | null) => {
      await callBg<Project>({
        type: "UPDATE_PROJECT",
        project: { ...project, parentId: targetParentId },
      });
      setMovingProject(null);
      await load();
    },
    [load],
  );

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onParentChange = (parentId: string) => {
    setNewProjectParentId(parentId);
    const parent = projects.find((p) => p.id === parentId);
    if (parent) {
      const parentScope = (projectPath(projects, parent.id)[0]?.spaceId ?? "global") || "global";
      setNewProjectScope(parentScope);
      if (!colorTouched) {
        setColor(effectiveColor(projects, parent.id));
      }
    }
  };

  const reorderProjects = async (nextProjects: Project[]) => {
    setProjects(nextProjects);
    await callBg<Project[]>({ type: "REORDER_PROJECTS", projects: nextProjects });
    await load();
  };

  const visibleEntries: Array<{ node: ProjectTreeNode; ancestorLast: boolean[] }> = [];
  const walkTree = (nodes: ProjectTreeNode[], ancestorLast: boolean[]): void => {
    nodes.forEach((n, idx) => {
      const isLast = idx === nodes.length - 1;
      const matchesSearch =
        !search.trim() || n.project.name.toLowerCase().includes(search.toLowerCase().trim());
      if (matchesSearch) {
        visibleEntries.push({ node: n, ancestorLast });
      }
      if (n.children.length > 0 && !collapsedIds.has(n.project.id)) {
        walkTree(n.children, [...ancestorLast, isLast]);
      }
    });
  };
  walkTree(buildProjectTree(projects), []);

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
            {visibleEntries.map(({ node, ancestorLast }) => {
              const p = node.project;
              const hasChildren = node.children.length > 0;
              const isCollapsed = collapsedIds.has(p.id);
              const totalTasks = subtreeTaskCount(projects, p.id, counts);

              const isDragging = draggedId === p.id;
              const isOverTop = dragOverId?.id === p.id && dragOverId.isTop;
              const isOverBottom = dragOverId?.id === p.id && !dragOverId.isTop;

              return (
                <div
                  key={p.id}
                  className={`project-item-card${isDragging ? " dragging" : ""}${
                    isOverTop ? " drag-over-top" : ""
                  }${isOverBottom ? " drag-over-bottom" : ""}`}
                  style={{
                    paddingInlineStart: `${6 + node.depth * 18}px`,
                  }}
                  draggable={draggableId === p.id}
                  onDragStart={(e) => {
                    setDraggedId(p.id);
                    e.dataTransfer.setData("text/plain", p.id);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                    setDraggableId(null);
                  }}
                  onDragOver={(e) => {
                    if (!draggedId || draggedId === p.id) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const isTop = e.clientY < rect.top + rect.height / 2;
                    setDragOverId({ id: p.id, isTop });
                  }}
                  onDragLeave={() => {
                    if (dragOverId?.id === p.id) setDragOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!draggedId || draggedId === p.id) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const isTop = e.clientY < rect.top + rect.height / 2;
                    const next = reorderProjectTree(projects, draggedId, p.id, isTop ? "before" : "after");
                    setDraggedId(null);
                    setDragOverId(null);
                    setDraggableId(null);
                    if (next !== projects) {
                      void reorderProjects(next);
                    }
                  }}
                >
                  {/* Connector rails */}
                  {Array.from({ length: node.depth }).map((_, a) => {
                    const isParentLevel = a === node.depth - 1;
                    if (!isParentLevel && ancestorLast[a]) return null;
                    return (
                      <span
                        key={a}
                        className={`popup-tree-guide${isParentLevel ? " elbow" : ""}`}
                        style={{
                          top: 0,
                          bottom: isParentLevel ? undefined : 0,
                          height: isParentLevel ? "50%" : undefined,
                          insetInlineStart: `${6 + a * 18 + 7}px`,
                        }}
                      />
                    );
                  })}

                  {/* Drag handle */}
                  <span
                    className="popup-drag-handle"
                    title="Drag to reorder"
                    onPointerDown={() => setDraggableId(p.id)}
                    onMouseDown={() => setDraggableId(p.id)}
                  >
                    ⋮⋮
                  </span>

                  {/* Expander toggle */}
                  {hasChildren ? (
                    <button
                      type="button"
                      className="popup-tree-expander"
                      onClick={() => toggleCollapse(p.id)}
                      title={isCollapsed ? "Expand sub-projects" : "Collapse sub-projects"}
                    >
                      {isCollapsed ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span className="popup-tree-spacer" />
                  )}

                  <span
                    className="project-jewel-dot"
                    style={{ background: effectiveColor(projects, p.id) }}
                  />

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
                      <span
                        className="project-card-name"
                        dir="auto"
                        title={projectPath(projects, p.id).map((x) => x.name).join(" › ")}
                      >
                        {p.name}
                      </span>
                      <select
                        className={p.spaceId ? "project-scope-select scope-specific" : "project-scope-select"}
                        value={(projectPath(projects, p.id)[0]?.spaceId ?? null) ?? "global"}
                        disabled={Boolean(p.parentId)}
                        onChange={(e) =>
                          void updateScope(p.id, e.target.value === "global" ? null : e.target.value)
                        }
                        title={
                          p.parentId
                            ? "Sub-projects inherit the parent project's scope"
                            : `Scope: ${!p.spaceId || p.spaceId === "global" ? "Global (All Spaces)" : (spaces.find((s) => s.id === p.spaceId)?.name ?? p.spaceId)}`
                        }
                      >
                        <option value="global">🌐 Global</option>
                        {spaces.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <span
                        className="project-task-pill"
                        title={hasChildren ? `Includes sub-projects (${counts.get(p.id) ?? 0} direct)` : undefined}
                      >
                        {totalTasks} tasks
                      </span>
                      <div className="project-actions">
                        <ColorPicker
                          value={p.color || effectiveColor(projects, p.id)}
                          onChange={(c) => void recolor(p.id, c)}
                          title="Recolor"
                        />
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
                          title="Move under another project"
                          onClick={() => setMovingProject(p)}
                        >
                          ⤷
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Delete"
                          onClick={() =>
                            setDeletingProject({
                              id: p.id,
                              name: p.name,
                              directCount: counts.get(p.id) ?? 0,
                              subCount: descendantsOf(projects, p.id).length,
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
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

        {/* Parent selector for sub-projects */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0" }}>
          <span className="scope-label" style={{ minWidth: "50px" }}>Parent:</span>
          <select
            className="project-scope-select"
            style={{ flex: 1, padding: "5px 8px" }}
            value={newProjectParentId}
            onChange={(e) => onParentChange(e.target.value)}
          >
            <option value="">No parent (top level)</option>
            {flattenTree(buildProjectTree(projects)).map((n) => (
              <option key={n.project.id} value={n.project.id}>
                {" ".repeat(n.depth * 2)}
                {n.depth > 0 ? "↳ " : ""}
                {n.project.name}
              </option>
            ))}
          </select>
        </div>

        {/* Scope selector for new project */}
        <div className="new-project-scope-row">
          <span className="scope-label" style={{ minWidth: "50px" }}>Scope:</span>
          <button
            type="button"
            className={newProjectScope === "global" ? "scope-chip active" : "scope-chip"}
            disabled={Boolean(newProjectParentId)}
            title={newProjectParentId ? "Sub-projects inherit the parent's scope" : ""}
            onClick={() => setNewProjectScope("global")}
          >
            🌐 Global
          </button>
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              className={newProjectScope === s.id ? "scope-chip active" : "scope-chip"}
              disabled={Boolean(newProjectParentId)}
              title={newProjectParentId ? "Sub-projects inherit the parent's scope" : ""}
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
              onClick={() => {
                setColor(c);
                setColorTouched(true);
              }}
              title={c}
            />
          ))}
          <ColorPicker
            value={color}
            onChange={(c) => {
              setColor(c);
              setColorTouched(true);
            }}
            direction="up"
            title="Full color palette"
          />
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

      {/* Move Project Modal */}
      {movingProject && (
        <div className="popup-confirm-overlay" onClick={() => setMovingProject(null)}>
          <div className="popup-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="popup-confirm-title">
              <span>⤷</span>
              <span>Move "{movingProject.name}"</span>
            </div>
            <p className="desc-text" style={{ margin: "4px 0 10px" }}>
              Choose a new parent project or move it to the top level:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflowY: "auto" }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ textAlign: "start", justifyContent: "flex-start" }}
                onClick={() => void moveProject(movingProject, null)}
              >
                ⤒ Top level (no parent)
              </button>
              {flattenTree(
                buildProjectTree(
                  projects.filter(
                    (p) =>
                      p.id !== movingProject.id &&
                      !descendantsOf(projects, movingProject.id).some((d) => d.id === p.id),
                  ),
                ),
              ).map((n) => (
                <button
                  key={n.project.id}
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    textAlign: "start",
                    justifyContent: "flex-start",
                    paddingInlineStart: `${10 + n.depth * 14}px`,
                  }}
                  onClick={() => void moveProject(movingProject, n.project.id)}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: effectiveColor(projects, n.project.id),
                      display: "inline-block",
                      marginInlineEnd: "6px",
                    }}
                  />
                  {n.project.name}
                </button>
              ))}
            </div>
            <div className="popup-confirm-actions" style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setMovingProject(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
              {deletingProject.directCount > 0 && (
                <>
                  <br />
                  <span style={{ color: "#fbbf24" }}>
                    {deletingProject.directCount} linked tasks will lose their project assignment.
                  </span>
                </>
              )}
              {deletingProject.subCount > 0 && (
                <>
                  <br />
                  <span style={{ color: "#f87171" }}>
                    ⚠️ This project has {deletingProject.subCount} sub-project{deletingProject.subCount === 1 ? "" : "s"} in its tree.
                  </span>
                </>
              )}
            </p>
            <div className="popup-confirm-actions" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeletingProject(null)}
              >
                Cancel
              </button>
              {deletingProject.subCount > 0 ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void executeDelete("promote")}
                    title="Delete parent only; children move up into this project's place"
                  >
                    Delete parent only (promote {deletingProject.subCount} sub)
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void executeDelete("cascade")}
                  >
                    Delete everything ({deletingProject.subCount + 1} projects)
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void executeDelete("cascade")}
                >
                  Delete Project
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
