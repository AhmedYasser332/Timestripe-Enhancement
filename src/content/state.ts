/**
 * In-page live state manager (PRD §44).
 * Reads directly from chrome.storage.local and listens to storage.onChanged so
 * setting toggles, project edits, and reassignments reflect INSTANTLY in the DOM
 * without a page refresh or waiting on service-worker round trips.
 */

import { resolveAssignments } from "../shared/inheritance";
import { sendToBg } from "./messaging";
import type {
  AssignmentInfo,
  Project,
  Settings,
  SpaceData,
  TaskTextConfig,
  ViewState,
} from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/storage";

let settings: Settings = DEFAULT_SETTINGS;
let activeSpaceId: string | null = null;
let projects: Project[] = [];
let taskProjectLinks: Record<string, { projectId: string }> = {};
let taskColorOverrides: Record<string, string> = {};
let taskTextConfigs: Record<string, TaskTextConfig> = {};
let taskProgressNotes: Record<string, string> = {};
let goalParents: Record<string, string | null> = {};
let assignments: Record<string, AssignmentInfo> = {};
let onUpdateCb: (() => void) | null = null;
let fetchingIndex = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastKnownVisibleIds: string[] = [];

function recompute(): void {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const resolved = resolveAssignments(goalParents, taskProjectLinks);
  const next: Record<string, AssignmentInfo> = {};
  for (const [goalId, res] of Object.entries(resolved)) {
    const project = byId.get(res.projectId);
    if (project) {
      const overrideColor = taskColorOverrides[goalId];
      next[goalId] = {
        projectId: res.projectId,
        name: project.name,
        color: overrideColor ?? project.color,
        source: res.source,
        colorSource: overrideColor ? "override" : "project",
        overrideColor,
      };
    }
  }

  // Also include goals with color overrides even if not assigned to a project
  for (const [goalId, overrideColor] of Object.entries(taskColorOverrides)) {
    if (!next[goalId] && overrideColor) {
      next[goalId] = {
        projectId: "",
        name: "",
        color: overrideColor,
        source: "explicit",
        colorSource: "override",
        overrideColor,
      };
    }
  }

  assignments = next;
  onUpdateCb?.();
}

function parentsStorageKey(spaceId: string): string {
  return `parents:${spaceId}`;
}

async function loadSpaceData(spaceId: string): Promise<void> {
  const pKey = parentsStorageKey(spaceId);

  if (spaceId === "all") {
    const all = await chrome.storage.local.get(null);
    const projMap = new Map<string, Project>();
    const mergedLinks: Record<string, { projectId: string }> = {};
    const mergedOverrides: Record<string, string> = {};
    const mergedTexts: Record<string, TaskTextConfig> = {};
    const mergedNotes: Record<string, string> = {};

    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith("data:") && val && typeof val === "object") {
        const d = val as Partial<SpaceData>;
        for (const p of d.projects ?? []) {
          projMap.set(p.id, p);
        }
        Object.assign(mergedLinks, d.taskProjectLinks ?? {});
        Object.assign(mergedOverrides, d.taskColorOverrides ?? {});
        Object.assign(mergedTexts, d.taskTextConfigs ?? {});
        Object.assign(mergedNotes, d.taskProgressNotes ?? {});
      }
    }
    projects = Array.from(projMap.values());
    taskProjectLinks = mergedLinks;
    taskColorOverrides = mergedOverrides;
    taskTextConfigs = mergedTexts;
    taskProgressNotes = mergedNotes;
  } else {
    const spaceKey = `data:${spaceId}`;
    const globalKey = `data:global`;
    const res = await chrome.storage.local.get([spaceKey, globalKey, pKey]);
    const spaceData = res[spaceKey] as Partial<SpaceData> | undefined;
    const globalData = res[globalKey] as Partial<SpaceData> | undefined;

    const projMap = new Map<string, Project>();
    for (const p of globalData?.projects ?? []) {
      projMap.set(p.id, p);
    }
    for (const p of spaceData?.projects ?? []) {
      projMap.set(p.id, p);
    }
    projects = Array.from(projMap.values());
    taskProjectLinks = { ...(globalData?.taskProjectLinks ?? {}), ...(spaceData?.taskProjectLinks ?? {}) };
    taskColorOverrides = { ...(globalData?.taskColorOverrides ?? {}), ...(spaceData?.taskColorOverrides ?? {}) };
    taskTextConfigs = { ...(globalData?.taskTextConfigs ?? {}), ...(spaceData?.taskTextConfigs ?? {}) };
    taskProgressNotes = { ...(globalData?.taskProgressNotes ?? {}), ...(spaceData?.taskProgressNotes ?? {}) };

    const cachedParents = res[pKey] as Record<string, string | null> | undefined;
    if (cachedParents && typeof cachedParents === "object") {
      goalParents = { ...cachedParents, ...goalParents };
    }
  }
}

function saveParentsCache(spaceId: string): void {
  void chrome.storage.local.set({ [parentsStorageKey(spaceId)]: goalParents });
}

/**
 * Register parent-child relationships discovered immediately from the DOM (0ms latency).
 * For example, a newly added subgoal row nested inside a parent row.
 */
export function registerDomParents(pairs: Array<{ goalId: string; parentId: string }>): void {
  if (!activeSpaceId || pairs.length === 0) return;
  let changed = false;
  for (const { goalId, parentId } of pairs) {
    if (goalParents[goalId] !== parentId) {
      goalParents[goalId] = parentId;
      changed = true;
    }
  }
  if (changed) {
    saveParentsCache(activeSpaceId);
    recompute();
  }
}

async function fetchGoalParents(spaceId: string, retryAttempt = 0): Promise<void> {
  if (fetchingIndex) return;
  fetchingIndex = true;
  try {
    const res = await sendToBg<Record<string, string | null>>({
      type: "GET_GOAL_INDEX",
      spaceId,
    });
    if (res?.ok) {
      goalParents = { ...goalParents, ...res.data };
      saveParentsCache(spaceId);
      recompute();

      // Check if any visible goals are STILL unknown (e.g. newly created goal still in-flight on Timestripe's server)
      const stillUnknown = lastKnownVisibleIds.some((id) => !(id in goalParents));
      if (stillUnknown && retryAttempt < 4) {
        const delays = [450, 1100, 2400, 4500];
        const nextDelay = delays[retryAttempt] ?? 2000;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          void fetchGoalParents(spaceId, retryAttempt + 1);
        }, nextDelay);
      }
    }
  } finally {
    fetchingIndex = false;
  }
}

export async function reloadAll(): Promise<void> {
  const stored = await chrome.storage.local.get(["settings"]);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
  activeSpaceId = settings.activeSpaceId;
  if (activeSpaceId) {
    await loadSpaceData(activeSpaceId);
    void fetchGoalParents(activeSpaceId);
  } else {
    projects = [];
    taskProjectLinks = {};
  }
  recompute();
}

/**
 * Check if any visible goals are unknown to the parent index.
 * If unknown goals exist, fetches the latest index and starts automatic retry polling
 * until Timestripe's server finishes saving the newly created goal.
 */
export function checkUnknownGoals(visibleGoalIds: string[]): void {
  if (!activeSpaceId || visibleGoalIds.length === 0) return;
  lastKnownVisibleIds = visibleGoalIds;
  const unknown = visibleGoalIds.some((id) => !(id in goalParents));
  if (unknown && !fetchingIndex && !retryTimer) {
    void fetchGoalParents(activeSpaceId, 0);
  }
}

/** Optimistic 0ms update for an assignment before the service worker finishes writing. */
export function optimisticAssign(goalId: string, projectId: string | null): void {
  if (projectId === null) {
    delete taskProjectLinks[goalId];
  } else {
    taskProjectLinks[goalId] = { projectId };
  }
  recompute();
}

/** Optimistic 0ms update for task color override. */
export function optimisticColorOverride(goalId: string, color: string | null): void {
  if (color === null) {
    delete taskColorOverrides[goalId];
  } else {
    taskColorOverrides[goalId] = color;
  }
  recompute();
}

export function getViewState(): ViewState {
  return { settings, assignments };
}

export function getProjects(): Project[] {
  return projects;
}

export function getSettings(): Settings {
  return settings;
}

export function getActiveSpaceId(): string | null {
  return activeSpaceId;
}

export function getGoalParents(): Record<string, string | null> {
  return goalParents;
}

export function getTaskColorOverrides(): Record<string, string> {
  return taskColorOverrides;
}

export function getTaskTextConfigs(): Record<string, TaskTextConfig> {
  return taskTextConfigs;
}

export function getTaskProjectLinks(): Record<string, { projectId: string }> {
  return taskProjectLinks;
}

export function getTaskProgressNotes(): Record<string, string> {
  return taskProgressNotes;
}

export function optimisticProgressNote(goalId: string, note: string | null): void {
  if (!note || note.trim().length === 0 || note.trim() === "0") {
    delete taskProgressNotes[goalId];
  } else {
    taskProgressNotes[goalId] = note.trim();
  }
  onUpdateCb?.();
}

export function optimisticTextConfig(goalId: string, patch: Partial<TaskTextConfig> | null): void {
  if (patch === null) {
    delete taskTextConfigs[goalId];
  } else {
    taskTextConfigs[goalId] = { ...(taskTextConfigs[goalId] ?? {}), ...patch };
  }
  recompute();
}

/** Initialize live subscription to storage changes. Returns an unsubscribe fn. */
export function initLiveState(onUpdate: () => void): () => void {
  onUpdateCb = onUpdate;
  void reloadAll();

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local") return;

    let needsRecompute = false;
    let reloadNeeded = false;

    if (changes.settings) {
      const nextSettings = changes.settings.newValue as Settings | undefined;
      const prevSpace = settings.activeSpaceId;
      settings = { ...DEFAULT_SETTINGS, ...nextSettings };
      activeSpaceId = settings.activeSpaceId;
      if (activeSpaceId !== prevSpace) {
        reloadNeeded = true;
      } else {
        needsRecompute = true;
      }
    }

    const hasDataChange = Object.keys(changes).some(
      (k) =>
        k === "data:global" ||
        (activeSpaceId && k === `data:${activeSpaceId}`) ||
        (activeSpaceId === "all" && k.startsWith("data:")),
    );

    if (hasDataChange) {
      reloadNeeded = true;
    }

    if (reloadNeeded) {
      void reloadAll();
    } else if (needsRecompute) {
      recompute();
    }
  };

  const onMessage = (msg: unknown): void => {
    if (typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "STATE_CHANGED") {
      void reloadAll();
    }
  };

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onMessage);

  return () => {
    if (retryTimer) clearTimeout(retryTimer);
    chrome.storage.onChanged.removeListener(onStorageChanged);
    chrome.runtime.onMessage.removeListener(onMessage);
    onUpdateCb = null;
  };
}
