/**
 * Shared hierarchical project picker UI (sub-projects feature).
 *
 * Used by BOTH assignment surfaces:
 *  - the native 3-dots menu flyout (menu-integration.ts)
 *  - the selection bar flyout (selection-ui.ts)
 *
 * Interaction (settled with the user 2026-10-05):
 *  - The flyout lists TOP-LEVEL parents only; a parent with children shows a
 *    small "›" arrow and hovering it opens a nested flyout with its children,
 *    recursively.
 *  - A bottom "Browse all projects…" row opens a full tree modal where a
 *    single click picks and closes — no chasing deep children through hovers.
 */

import { buildProjectTree, effectiveColor, flattenTree, projectPath, type ProjectTreeNode } from "../shared/project-tree";
import type { Project } from "../shared/types";

const STYLE_ID = "tse-tree-ui-styles";

/** Idempotent style injection — also used by the dashboard's delete dialog. */
export function injectTreeStyles(): void {
  if (document.getElementById(STYLE_ID)) return;  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tse-tree-arrow {
      margin-inline-start: auto;
      color: #71717a;
      font-size: 13px;
      line-height: 1;
      transition: color 0.1s ease;
    }
    .tse-menu-row:hover .tse-tree-arrow { color: #ffffff; }
    .tse-tree-chain { background: rgba(255, 255, 255, 0.06); }

    /* Full tree modal */
    .tse-tree-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: tseTreeFade 0.12s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    @keyframes tseTreeFade { from { opacity: 0; } to { opacity: 1; } }
    .tse-tree-box {
      width: 420px;
      max-width: calc(100vw - 32px);
      max-height: 70vh;
      background: #1c1c1e;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75);
      color: #f4f4f5;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: tseTreeScale 0.14s ease-out;
    }
    @keyframes tseTreeScale { from { transform: scale(0.97); } to { transform: scale(1); } }
    .tse-tree-head {
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .tse-tree-title { font-size: 14px; font-weight: 600; color: #ffffff; }
    .tse-tree-sub { font-size: 11.5px; color: #8e8e93; margin-top: 3px; line-height: 1.4; }
    .tse-tree-list { flex: 1; overflow-y: auto; padding: 8px; }
    .tse-tree-list::-webkit-scrollbar { width: 6px; }
    .tse-tree-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 999px; }
    .tse-tree-row {
      display: flex;
      align-items: center;
      gap: 9px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #e4e4e7;
      font: inherit;
      font-size: 13px;
      text-align: start;
      cursor: pointer;
      box-sizing: border-box;
      transition: background 0.1s ease;
    }
    .tse-tree-row:hover { background: rgba(255, 255, 255, 0.08); color: #ffffff; }
    .tse-tree-row.current { background: rgba(124, 92, 255, 0.14); }
    .tse-tree-dot {
      width: 10px; height: 10px; border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 0 5px rgba(0,0,0,0.4);
    }
    .tse-tree-dot.inherited { box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.35); }
    .tse-tree-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tse-tree-count {
      margin-inline-start: auto;
      font-size: 10.5px;
      color: #8e8e93;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      padding: 1px 6px;
      border-radius: 6px;
      flex-shrink: 0;
    }
    .tse-tree-empty { padding: 18px 12px; color: #8e8e93; font-size: 12.5px; text-align: center; }
  `;
  document.head.appendChild(style);
}

export interface ProjectPickContext {
  projects: Project[];
  currentProjectId?: string | null;
  onPick: (project: Project) => void;
  onRemove?: () => void;
  onBrowseAll: () => void;
}

/**
 * Fill a flyout container with the hierarchical picker. Returns a destroy()
 * that closes any open nested child flyouts — call it from the host's close
 * path so nothing leaks.
 */
export function fillProjectFlyout(root: HTMLElement, ctx: ProjectPickContext): () => void {
  injectTreeStyles();

  const nested: HTMLElement[] = [];
  const timers: (ReturnType<typeof setTimeout> | undefined)[] = [];

  const closeNestedFrom = (level: number): void => {
    while (nested.length > level) {
      const el = nested.pop();
      el?.remove();
    }
  };

  const chainToCurrent = new Set(
    ctx.currentProjectId ? projectPath(ctx.projects, ctx.currentProjectId).slice(0, -1).map((p) => p.id) : [],
  );

  const buildLevel = (container: HTMLElement, nodes: ProjectTreeNode[], level: number): void => {
    for (const node of nodes) {
      const p = node.project;
      const isCurrent = p.id === ctx.currentProjectId;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tse-menu-row" + (isCurrent ? " tse-checked" : "") + (chainToCurrent.has(p.id) ? " tse-tree-chain" : "");

      const dot = document.createElement("span");
      dot.className = "tse-current-dot";
      dot.style.background = effectiveColor(ctx.projects, p.id);
      row.appendChild(dot);

      const label = document.createElement("span");
      label.textContent = p.name;
      label.dir = "auto";
      row.appendChild(label);

      if (isCurrent) {
        const chk = document.createElement("span");
        chk.className = "tse-check";
        chk.textContent = "✓";
        row.appendChild(chk);
      }

      if (node.children.length > 0) {
        const arrow = document.createElement("span");
        arrow.className = "tse-tree-arrow";
        arrow.textContent = "›";
        row.appendChild(arrow);

        row.addEventListener("mouseenter", () => {
          closeNestedFrom(level + 1);
          const childFly = document.createElement("div");
          childFly.className = "tse-flyout";
          childFly.addEventListener("mouseenter", () => cancelTimer(level));
          childFly.addEventListener("mouseleave", () => armClose(level));
          buildLevel(childFly, node.children, level + 1);
          document.body.appendChild(childFly);
          nested[level] = childFly;

          const r = row.getBoundingClientRect();
          const fw = childFly.offsetWidth;
          const fh = childFly.offsetHeight;
          let left = r.right + 4;
          if (left + fw > window.innerWidth - 8) left = r.left - fw - 4;
          let top = r.top - 4;
          if (top + fh > window.innerHeight - 8) top = window.innerHeight - fh - 8;
          childFly.style.left = `${Math.max(8, left)}px`;
          childFly.style.top = `${Math.max(8, top)}px`;
        });
        row.addEventListener("mouseleave", () => armClose(level));
      }

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        destroy();
        ctx.onPick(p);
      });
      container.appendChild(row);
    }
  };

  const cancelTimer = (level: number): void => {
    const t = timers[level];
    if (t) {
      clearTimeout(t);
      timers[level] = undefined;
    }
  };
  const armClose = (level: number): void => {
    cancelTimer(level);
    timers[level] = setTimeout(() => closeNestedFrom(level + 1), 220);
  };

  buildLevel(root, buildProjectTree(ctx.projects), 0);

  const sep = document.createElement("div");
  sep.className = "tse-flyout-sep";
  root.appendChild(sep);

  const browseRow = document.createElement("button");
  browseRow.type = "button";
  browseRow.className = "tse-menu-row";
  browseRow.textContent = "Browse all projects…";
  browseRow.addEventListener("click", (e) => {
    e.stopPropagation();
    destroy();
    ctx.onBrowseAll();
  });
  root.appendChild(browseRow);

  if (ctx.currentProjectId && ctx.onRemove) {
    const removeRow = document.createElement("button");
    removeRow.type = "button";
    removeRow.className = "tse-menu-row";
    removeRow.textContent = "Remove project";
    removeRow.addEventListener("click", (e) => {
      e.stopPropagation();
      destroy();
      ctx.onRemove?.();
    });
    root.appendChild(removeRow);
  }

  const destroy = (): void => {
    closeNestedFrom(0);
    for (let i = 0; i < timers.length; i++) cancelTimer(i);
  };
  return destroy;
}

export interface TreeModalOptions {
  projects: Project[];
  title: string;
  subtitle?: string;
  onPick: (project: Project | null) => void;
  onRemove?: () => void;
  /** Move mode: offer a "Top level" row that calls onPick(null). */
  allowTopLevel?: boolean;
  /** Move mode: highlighted current parent. */
  currentParentId?: string | null;
  /** Move mode: ids that cannot receive children (self + its descendants). */
  excludeIds?: string[];
}

/** Centered modal with the full indented project tree. Single click picks and closes. */
export function openProjectTreeModal(opts: TreeModalOptions): void {
  injectTreeStyles();

  const excluded = new Set(opts.excludeIds ?? []);
  const pruned = opts.projects.filter((p) => !excluded.has(p.id));

  const backdrop = document.createElement("div");
  backdrop.className = "tse-tree-backdrop";

  const box = document.createElement("div");
  box.className = "tse-tree-box";

  const head = document.createElement("div");
  head.className = "tse-tree-head";
  const title = document.createElement("div");
  title.className = "tse-tree-title";
  title.textContent = opts.title;
  head.appendChild(title);
  if (opts.subtitle) {
    const sub = document.createElement("div");
    sub.className = "tse-tree-sub";
    sub.textContent = opts.subtitle;
    head.appendChild(sub);
  }
  box.appendChild(head);

  const list = document.createElement("div");
  list.className = "tse-tree-list";

  const pick = (p: Project | null): void => {
    close();
    opts.onPick(p);
  };

  if (opts.allowTopLevel) {
    const topRow = document.createElement("button");
    topRow.type = "button";
    topRow.className = "tse-tree-row" + ((opts.currentParentId ?? null) === null ? " current" : "");
    topRow.textContent = "⤒ Top level (no parent)";
    topRow.addEventListener("click", () => pick(null));
    list.appendChild(topRow);
  }

  const rows = flattenTree(buildProjectTree(pruned));
  if (rows.length === 0 && !opts.allowTopLevel) {
    const empty = document.createElement("div");
    empty.className = "tse-tree-empty";
    empty.textContent = "No projects yet.";
    list.appendChild(empty);
  }

  const currentChain = new Set(
    opts.currentParentId ? projectPath(pruned, opts.currentParentId).slice(0, -1).map((p) => p.id) : [],
  );

  for (const node of rows) {
    const p = node.project;
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "tse-tree-row" +
      (p.id === opts.currentParentId || currentChain.has(p.id) ? " current" : "");
    row.style.paddingInlineStart = `${10 + node.depth * 18}px`;
    if (node.depth > 0) row.title = projectPath(pruned, p.id).map((x) => x.name).join(" › ");

    const dot = document.createElement("span");
    dot.className = "tse-tree-dot" + (p.parentId && !p.color ? " inherited" : "");
    dot.style.background = effectiveColor(pruned, p.id);
    row.appendChild(dot);

    const label = document.createElement("span");
    label.className = "tse-tree-label";
    label.textContent = p.name;
    label.dir = "auto";
    row.appendChild(label);

    if (node.children.length > 0) {
      const count = document.createElement("span");
      count.className = "tse-tree-count";
      count.textContent = `${node.children.length} sub`;
      row.appendChild(count);
    }

    row.addEventListener("click", () => pick(p));
    list.appendChild(row);
  }

  if (opts.onRemove) {
    const removeRow = document.createElement("button");
    removeRow.type = "button";
    removeRow.className = "tse-tree-row";
    removeRow.style.color = "#f87171";
    removeRow.textContent = "✕ Remove project";
    removeRow.addEventListener("click", () => {
      close();
      opts.onRemove?.();
    });
    list.appendChild(removeRow);
  }

  box.appendChild(list);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });

  // Focus the list container for immediate scrolling
  list.tabIndex = -1;
  list.focus();
}
