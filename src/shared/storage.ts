/**
 * Typed storage layer over chrome.storage.local (PRD §38).
 * Per-space data is namespaced under `data:{spaceId}` (PRD §41.6); the API key
 * lives in its own key and never enters the bundle.
 */

import type { Project, Settings, SpaceData } from "./types";

const SCHEMA_VERSION = 1;
const SCHEMA_KEY = "schemaVersion";
const API_KEY_STORAGE = "apiKey";
const SETTINGS_KEY = "settings";
const DATA_PREFIX = "data:";

export const DEFAULT_SETTINGS: Settings = {
  activeSpaceId: null,
  colorMode: "strip",
  showProjectName: true,
};

const DEFAULT_SPACE_DATA: SpaceData = {
  projects: [],
  taskProjectLinks: {},
  taskColorOverrides: {},
};

function spaceKey(spaceId: string): string {
  return `${DATA_PREFIX}${spaceId}`;
}

export async function getApiKey(): Promise<string | null> {
  const { [API_KEY_STORAGE]: key } = await chrome.storage.local.get(API_KEY_STORAGE);
  return typeof key === "string" && key.length > 0 ? key : null;
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [API_KEY_STORAGE]: key });
}

export async function getSettings(): Promise<Settings> {
  const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getSpaceData(spaceId: string): Promise<SpaceData> {
  const { [spaceKey(spaceId)]: data } = await chrome.storage.local.get(spaceKey(spaceId));
  if (!data) return { ...DEFAULT_SPACE_DATA, projects: [], taskProjectLinks: {}, taskColorOverrides: {} };
  const d = data as Partial<SpaceData>;
  return {
    projects: d.projects ?? [],
    taskProjectLinks: d.taskProjectLinks ?? {},
    taskColorOverrides: d.taskColorOverrides ?? {},
  };
}

export async function setSpaceData(spaceId: string, data: SpaceData): Promise<void> {
  await chrome.storage.local.set({ [spaceKey(spaceId)]: data, [SCHEMA_KEY]: SCHEMA_VERSION });
}

export async function updateSpaceData(
  spaceId: string,
  mutator: (data: SpaceData) => SpaceData,
): Promise<SpaceData> {
  const data = await getSpaceData(spaceId);
  const next = mutator(data);
  await setSpaceData(spaceId, next);
  return next;
}

// ---------- project helpers ----------

export const GLOBAL_SPACE_ID = "global";

export async function getAllStoredSpaceData(): Promise<Map<string, SpaceData>> {
  const all = await chrome.storage.local.get(null);
  const result = new Map<string, SpaceData>();
  for (const [key, val] of Object.entries(all)) {
    if (key.startsWith(DATA_PREFIX) && val && typeof val === "object") {
      const spaceId = key.slice(DATA_PREFIX.length);
      const d = val as Partial<SpaceData>;
      result.set(spaceId, {
        projects: d.projects ?? [],
        taskProjectLinks: d.taskProjectLinks ?? {},
        taskColorOverrides: d.taskColorOverrides ?? {},
        templates: d.templates ?? [],
        taskTextConfigs: d.taskTextConfigs ?? {},
      });
    }
  }
  return result;
}

export async function getAllProjects(): Promise<Project[]> {
  const map = await getAllStoredSpaceData();
  const projMap = new Map<string, Project>();
  for (const [spaceId, data] of map.entries()) {
    for (const p of data.projects) {
      if (!projMap.has(p.id)) {
        // If p doesn't have spaceId property, infer from container unless container was global
        const scope = p.spaceId !== undefined ? p.spaceId : (spaceId === GLOBAL_SPACE_ID ? null : spaceId);
        projMap.set(p.id, { ...p, spaceId: scope });
      }
    }
  }
  return Array.from(projMap.values());
}

export async function getProjectsForSpace(spaceId: string | null): Promise<Project[]> {
  const allProjects = await getAllProjects();
  if (!spaceId || spaceId === "all") {
    return allProjects;
  }
  return allProjects.filter((p) => !p.spaceId || p.spaceId === "global" || p.spaceId === spaceId);
}

export async function upsertProjectWithScope(project: Project): Promise<void> {
  const targetSpace = project.spaceId && project.spaceId !== "global" ? project.spaceId : GLOBAL_SPACE_ID;
  const allData = await getAllStoredSpaceData();

  // 1. Remove this project from any other space where it might have been previously
  for (const [sId, data] of allData.entries()) {
    if (sId !== targetSpace && data.projects.some((p) => p.id === project.id)) {
      await updateSpaceData(sId, (d) => ({
        ...d,
        projects: d.projects.filter((p) => p.id !== project.id),
      }));
    }
  }

  // 2. Upsert in target space
  await updateSpaceData(targetSpace, (d) => {
    const exists = d.projects.some((p) => p.id === project.id);
    const projects = exists
      ? d.projects.map((p) => (p.id === project.id ? { ...project, updatedAt: new Date().toISOString() } : p))
      : [...d.projects, project];
    return { ...d, projects };
  });
}

export async function removeProjectEverywhere(projectId: string): Promise<void> {
  const allData = await getAllStoredSpaceData();
  for (const [sId, data] of allData.entries()) {
    const hasProject = data.projects.some((p) => p.id === projectId);
    const hasLinks = Object.values(data.taskProjectLinks).some((l) => l.projectId === projectId);
    if (hasProject || hasLinks) {
      await updateSpaceData(sId, (d) => ({
        ...d,
        projects: d.projects.filter((p) => p.id !== projectId),
        taskProjectLinks: Object.fromEntries(
          Object.entries(d.taskProjectLinks).filter(([, link]) => link.projectId !== projectId),
        ),
      }));
    }
  }
}

export function newProject(name: string, color: string, spaceId?: string | null): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    color,
    createdAt: now,
    updatedAt: now,
    archived: false,
    spaceId: spaceId ?? null,
  };
}

export async function upsertProject(spaceId: string, project: Project): Promise<Project[]> {
  return updateSpaceData(spaceId, (d) => {
    const exists = d.projects.some((p) => p.id === project.id);
    const projects = exists
      ? d.projects.map((p) => (p.id === project.id ? { ...project, updatedAt: new Date().toISOString() } : p))
      : [...d.projects, project];
    return { ...d, projects };
  }).then((d) => d.projects);
}

export async function removeProject(spaceId: string, projectId: string): Promise<Project[]> {
  return updateSpaceData(spaceId, (d) => ({
    projects: d.projects.filter((p) => p.id !== projectId),
    taskProjectLinks: Object.fromEntries(
      Object.entries(d.taskProjectLinks).filter(([, link]) => link.projectId !== projectId),
    ),
  })).then((d) => d.projects);
}

export async function setTaskProjectLinks(
  spaceId: string,
  goalIds: string[],
  projectId: string | null,
): Promise<void> {
  await updateSpaceData(spaceId, (d) => {
    const links = { ...d.taskProjectLinks };
    for (const goalId of goalIds) {
      if (projectId == null) delete links[goalId];
      else links[goalId] = { projectId };
    }
    return { ...d, taskProjectLinks: links };
  });
}

export async function setTaskColorOverrides(
  spaceId: string,
  goalIds: string[],
  color: string | null,
): Promise<void> {
  await updateSpaceData(spaceId, (d) => {
    const overrides = { ...(d.taskColorOverrides ?? {}) };
    for (const goalId of goalIds) {
      if (color == null) {
        delete overrides[goalId];
      } else {
        overrides[goalId] = color;
      }
    }
    return { ...d, taskColorOverrides: overrides };
  });
}

export async function setTaskTextConfigs(
  spaceId: string,
  goalIds: string[],
  patch: Partial<import("./types").TaskTextConfig> | null,
): Promise<void> {
  await updateSpaceData(spaceId, (d) => {
    const configs = { ...(d.taskTextConfigs ?? {}) };
    for (const goalId of goalIds) {
      if (patch == null) {
        delete configs[goalId];
      } else {
        configs[goalId] = { ...(configs[goalId] ?? {}), ...patch };
      }
    }
    return { ...d, taskTextConfigs: configs };
  });
}
