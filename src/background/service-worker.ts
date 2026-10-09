// Service worker — owns storage, the Timestripe API client, inheritance resolution,
// context menus and change broadcast (PRD §45). No feature state is kept in memory:
// the SW can die at any time, chrome.storage.local is the source of truth.

import { TimestripeApi } from "../shared/api";
import { addDays, computeDayOffset } from "../shared/dates";
import { err, ok } from "../shared/messages";
import type {
  ApiResult,
  BackupPayload,
  BgMessage,
  BgResponseMap,
  BulkDeleteResult,
  DuplicateOptions,
  SmartDuplicateResult,
  TestApiData,
} from "../shared/messages";
import {
  GLOBAL_SPACE_ID,
  getAllProjects,
  getAllStoredSpaceData,
  getApiKey,
  getProjectsForSpace,
  getSettings,
  getSpaceData,
  pruneOrphanedStorageData,
  removeProjectEverywhere,
  reorderProjectsInStorage,
  setApiKey,
  setSettings,
  setTaskColorOverrides,
  setTaskProjectLinks,
  setTaskTextConfigs,
  updateSpaceData,
  upsertProjectWithScope,
  newProject,
} from "../shared/storage";
import type {
  GoalTemplate,
  Project,
  Settings,
  TaskProjectLink,
  TaskTextConfig,
  TemplateNode,
  TSGoal,
  TSSpace,
  ViewState,
} from "../shared/types";
import { resolveAssignments } from "../shared/inheritance";
import { descendantsOf, effectiveColor, projectPath } from "../shared/project-tree";

async function api(): Promise<TimestripeApi> {
  const key = await getApiKey();
  if (!key) throw new Error("No API key saved yet — add one in Settings.");
  return new TimestripeApi(key);
}

async function getGoalParents(spaceId: string): Promise<Record<string, string | null>> {
  const client = await api();
  if (spaceId === "all") {
    const spaces = await client.listSpaces();
    const lists = await Promise.all(spaces.map((s) => client.listGoals(s.id).catch(() => [])));
    return Object.fromEntries(lists.flat().map((g) => [g.id, g.parent_id]));
  }
  const goals = await client.listGoals(spaceId);
  return Object.fromEntries(goals.map((g) => [g.id, g.parent_id]));
}

/** Make sure a space is selected; fall back to the account's first space (PRD §41.6). */
async function ensureActiveSpace(): Promise<{ settings: Settings; spaces: TSSpace[] }> {
  const settings = await getSettings();
  const client = await api();
  const spaces = await client.listSpaces();
  if (spaces.length === 0) throw new Error("No Timestripe spaces found on this account.");
  if (settings.activeSpaceId === "all") {
    return { settings, spaces };
  }
  if (!settings.activeSpaceId || !spaces.some((s) => s.id === settings.activeSpaceId)) {
    const next = await setSettings({ activeSpaceId: spaces[0].id });
    return { settings: next, spaces };
  }
  return { settings, spaces };
}

function findTopLevelRoots(goalIds: string[], parents: Record<string, string | null>): string[] {
  const idSet = new Set(goalIds);
  return goalIds.filter((id) => {
    let curr = parents[id];
    while (curr) {
      if (idSet.has(curr)) return false;
      curr = parents[curr];
    }
    return true;
  });
}

async function getViewState(): Promise<ViewState> {
  const { settings, spaces } = await ensureActiveSpace();
  const spaceId = settings.activeSpaceId;

  let projectsList: Project[];
  const allLinks: Record<string, TaskProjectLink> = {};
  const overrides: Record<string, string> = {};
  const parents: Record<string, string | null> = {};

  if (spaceId === "all" || !spaceId) {
    projectsList = await getAllProjects();
    const storedMap = await getAllStoredSpaceData();
    for (const data of storedMap.values()) {
      Object.assign(allLinks, data.taskProjectLinks);
      Object.assign(overrides, data.taskColorOverrides);
    }
    // Fetch parents across all spaces in parallel
    await Promise.all(
      spaces.map(async (s) => {
        try {
          const p = await getGoalParents(s.id);
          Object.assign(parents, p);
        } catch {
          // ignore single-space index errors
        }
      }),
    );
  } else {
    projectsList = await getProjectsForSpace(spaceId);
    const [spaceData, globalData, spParents] = await Promise.all([
      getSpaceData(spaceId),
      getSpaceData(GLOBAL_SPACE_ID),
      getGoalParents(spaceId),
    ]);
    Object.assign(allLinks, globalData.taskProjectLinks, spaceData.taskProjectLinks);
    Object.assign(overrides, globalData.taskColorOverrides, spaceData.taskColorOverrides);
    Object.assign(parents, spParents);
  }

  const resolved = resolveAssignments(parents, allLinks);
  const byId = new Map(projectsList.map((p) => [p.id, p]));
  const assignments: ViewState["assignments"] = {};

  for (const [goalId, res] of Object.entries(resolved)) {
    const project = byId.get(res.projectId);
    if (project) {
      const overrideColor = overrides[goalId];
      const path = projectPath(projectsList, res.projectId).map((p) => p.name).join(" › ");
      assignments[goalId] = {
        projectId: res.projectId,
        name: project.name,
        color: overrideColor ?? effectiveColor(projectsList, res.projectId),
        source: res.source,
        colorSource: overrideColor ? "override" : "project",
        overrideColor,
        path,
      };
    }
  }

  // Also include goals with color overrides even if not assigned to a project
  for (const [goalId, overrideColor] of Object.entries(overrides)) {
    if (!assignments[goalId] && overrideColor) {
      assignments[goalId] = {
        projectId: "",
        name: "",
        color: overrideColor,
        source: "explicit",
        colorSource: "override",
        overrideColor,
      };
    }
  }

  return { settings, assignments };
}

async function bulkDeleteGoals(goalIds: string[]): Promise<BulkDeleteResult> {
  const spaceId = await requireActiveSpaceId();
  const client = await api();
  const parents = await getGoalParents(spaceId);
  const rootsToDelete = findTopLevelRoots(goalIds, parents);

  let completed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of rootsToDelete) {
    try {
      await client.deleteGoal(id);
      completed++;
    } catch (e) {
      failed++;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Clean up storage links and overrides for all selected goal IDs
  await updateSpaceData(spaceId, (d) => {
    const deletedSet = new Set(goalIds);
    const links = Object.fromEntries(
      Object.entries(d.taskProjectLinks).filter(([id]) => !deletedSet.has(id)),
    );
    const overrides = Object.fromEntries(
      Object.entries(d.taskColorOverrides ?? {}).filter(([id]) => !deletedSet.has(id)),
    );
    return { ...d, taskProjectLinks: links, taskColorOverrides: overrides };
  });

  await broadcastStateChanged();
  return { completed, failed, errors };
}

async function smartDuplicate(goalId: string, options: DuplicateOptions): Promise<SmartDuplicateResult> {
  const spaceId = await requireActiveSpaceId();
  const client = await api();
  const allGoals = await client.listGoals(spaceId);
  const byId = new Map(allGoals.map((g) => [g.id, g]));
  const rootGoal = byId.get(goalId);
  if (!rootGoal) throw new Error(`Goal ${goalId} not found`);

  // Build children map
  const childrenMap = new Map<string, TSGoal[]>();
  for (const g of allGoals) {
    if (g.parent_id) {
      const list = childrenMap.get(g.parent_id) ?? [];
      list.push(g);
      childrenMap.set(g.parent_id, list);
    }
  }

  // Calculate date offset if targetAnchorDate is specified
  let dayOffset = 0;
  if (options.copyDates && options.targetAnchorDate && rootGoal.date) {
    dayOffset = computeDayOffset(rootGoal.date, options.targetAnchorDate);
  }

  const computeDate = (origDate: string | null): string | null => {
    if (!options.copyDates) return null;
    if (!origDate) return null;
    if (dayOffset !== 0) return addDays(origDate, dayOffset);
    if (options.targetAnchorDate && !rootGoal.date) return options.targetAnchorDate;
    return origDate;
  };

  const oldToNew = new Map<string, string>();
  let totalCreated = 0;

  // 1. Create root goal
  const createdRoot = await client.createGoal({
    space_id: spaceId,
    parent_id: rootGoal.parent_id,
    bucket_id: rootGoal.bucket_id,
    horizon: options.copyHorizon ? rootGoal.horizon : null,
    date: computeDate(rootGoal.date),
    name: `${rootGoal.name} (Copy)`,
    description: options.copyNotes ? rootGoal.description : "",
    checked: options.copyCompletion ? rootGoal.checked : false,
  });
  oldToNew.set(rootGoal.id, createdRoot.id);
  totalCreated++;

  // 2. If tree scope, duplicate children recursively level by level
  if (options.scope === "tree") {
    const queue: Array<{ original: TSGoal; newParentId: string }> = [];
    const directChildren = childrenMap.get(rootGoal.id) ?? [];
    for (const child of directChildren) {
      queue.push({ original: child, newParentId: createdRoot.id });
    }

    while (queue.length > 0) {
      const item = queue.shift()!;
      const orig = item.original;
      const createdChild = await client.createGoal({
        space_id: spaceId,
        parent_id: item.newParentId,
        bucket_id: orig.bucket_id,
        horizon: options.copyHorizon ? orig.horizon : null,
        date: computeDate(orig.date),
        name: orig.name,
        description: options.copyNotes ? orig.description : "",
        checked: options.copyCompletion ? orig.checked : false,
      });
      oldToNew.set(orig.id, createdChild.id);
      totalCreated++;

      const nextChildren = childrenMap.get(orig.id) ?? [];
      for (const nextChild of nextChildren) {
        queue.push({ original: nextChild, newParentId: createdChild.id });
      }
    }
  }

  // 3. Copy extension metadata (project links & color overrides)
  if (options.copyProject || options.copyColors) {
    const spaceData = await getSpaceData(spaceId);
    await updateSpaceData(spaceId, (d) => {
      const links = { ...d.taskProjectLinks };
      const overrides = { ...(d.taskColorOverrides ?? {}) };

      for (const [oldId, newId] of oldToNew.entries()) {
        if (options.copyProject && spaceData.taskProjectLinks[oldId]) {
          links[newId] = spaceData.taskProjectLinks[oldId];
        }
        if (options.copyColors && spaceData.taskColorOverrides?.[oldId]) {
          overrides[newId] = spaceData.taskColorOverrides[oldId];
        }
      }

      return { ...d, taskProjectLinks: links, taskColorOverrides: overrides };
    });
  }

  await broadcastStateChanged();
  return { newRootId: createdRoot.id, totalCreated };
}

async function applyTemplate(templateId: string, targetAnchorDate: string): Promise<SmartDuplicateResult> {
  const spaceId = await requireActiveSpaceId();
  const client = await api();
  const spaceData = await getSpaceData(spaceId);
  const template = (spaceData.templates ?? []).find((t) => t.id === templateId);
  if (!template) throw new Error("Template not found");

  const nodes = template.nodes;
  const rootNode = nodes.find((n) => n.parentId === null) ?? nodes[0];
  if (!rootNode) throw new Error("Template contains no nodes");

  const tempIdToNewId = new Map<string, string>();
  let totalCreated = 0;

  // 1. Create root goal
  const createdRoot = await client.createGoal({
    space_id: spaceId,
    parent_id: null,
    horizon: rootNode.horizon,
    date: addDays(targetAnchorDate, rootNode.dayOffset),
    name: rootNode.name,
    description: rootNode.description,
    checked: false,
  });
  tempIdToNewId.set(rootNode.id, createdRoot.id);
  totalCreated++;

  // 2. Queue for children (breadth-first)
  const childrenMap = new Map<string, TemplateNode[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  const queue: Array<{ node: TemplateNode; newParentId: string }> = [];
  for (const child of childrenMap.get(rootNode.id) ?? []) {
    queue.push({ node: child, newParentId: createdRoot.id });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const n = item.node;
    const createdChild = await client.createGoal({
      space_id: spaceId,
      parent_id: item.newParentId,
      horizon: n.horizon,
      date: addDays(targetAnchorDate, n.dayOffset),
      name: n.name,
      description: n.description,
      checked: false,
    });
    tempIdToNewId.set(n.id, createdChild.id);
    totalCreated++;

    for (const nextChild of childrenMap.get(n.id) ?? []) {
      queue.push({ node: nextChild, newParentId: createdChild.id });
    }
  }

  // 3. Apply projects & color overrides from template
  await updateSpaceData(spaceId, (d) => {
    const links = { ...d.taskProjectLinks };
    const overrides = { ...(d.taskColorOverrides ?? {}) };

    for (const node of nodes) {
      const newId = tempIdToNewId.get(node.id);
      if (!newId) continue;
      if (node.projectId) links[newId] = { projectId: node.projectId };
      if (node.colorOverride) overrides[newId] = node.colorOverride;
    }

    return { ...d, taskProjectLinks: links, taskColorOverrides: overrides };
  });

  await broadcastStateChanged();
  return { newRootId: createdRoot.id, totalCreated };
}

async function requireActiveSpaceId(): Promise<string> {
  const { settings, spaces } = await ensureActiveSpace();
  if (settings.activeSpaceId && settings.activeSpaceId !== "all") {
    return settings.activeSpaceId;
  }
  return spaces[0]?.id ?? GLOBAL_SPACE_ID;
}

/** Push a "refetch" nudge to every open timestripe tab. */
async function broadcastStateChanged(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://timestripe.com/*" });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    void chrome.tabs.sendMessage(tab.id, { type: "STATE_CHANGED" }).catch(() => {
      // tab without the content script (stale page) — ignore
    });
  }
}

async function getAliveGoalIds(): Promise<Set<string> | undefined> {
  try {
    const client = await api();
    const settings = await getSettings();
    if (settings.activeSpaceId === "all") {
      const spaces = await client.listSpaces();
      const lists = await Promise.all(spaces.map((s) => client.listGoals(s.id).catch(() => [])));
      return new Set(lists.flat().map((g) => g.id));
    } else if (settings.activeSpaceId) {
      const goals = await client.listGoals(settings.activeSpaceId);
      return new Set(goals.map((g) => g.id));
    }
  } catch {
    // Offline, rate-limited, or no API key configured
  }
  return undefined;
}

async function generateCleanBackup(): Promise<BackupPayload> {
  const settings = await getSettings();
  const allProjects = await getAllProjects();

  if (settings.activeSpaceId === "all") {
    const allData = await getAllStoredSpaceData();
    const mergedLinks: Record<string, TaskProjectLink> = {};
    const mergedOverrides: Record<string, string> = {};
    const mergedTexts: Record<string, TaskTextConfig> = {};
    const allTemplates: GoalTemplate[] = [];

    for (const d of allData.values()) {
      Object.assign(mergedLinks, d.taskProjectLinks);
      Object.assign(mergedOverrides, d.taskColorOverrides);
      Object.assign(mergedTexts, d.taskTextConfigs);
      if (d.templates) allTemplates.push(...d.templates);
    }

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      spaceId: "all",
      data: {
        projects: allProjects,
        taskProjectLinks: mergedLinks,
        taskColorOverrides: mergedOverrides,
        templates: allTemplates,
        taskTextConfigs: mergedTexts,
      },
    };
  }

  const spaceId = await requireActiveSpaceId();
  const spaceData = await getSpaceData(spaceId);
  const projectsForSpace = await getProjectsForSpace(spaceId);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    spaceId,
    data: {
      ...spaceData,
      projects: projectsForSpace,
    },
  };
}

// ---------- message router ----------

type Handler<T extends BgMessage = BgMessage> = (msg: T) => Promise<BgResponseMap[keyof BgResponseMap]>;

const handlers: { [K in keyof BgResponseMap]?: (msg: Extract<BgMessage, { type: K }>) => Promise<BgResponseMap[K]> } = {
  GET_VIEW_STATE: () => getViewState(),
  GET_GOAL_INDEX: async (msg) => {
    const { settings, spaces } = await ensureActiveSpace();
    const spaceId = msg.spaceId ?? settings.activeSpaceId;
    if (spaceId === "all" || !spaceId) {
      const allParents: Record<string, string | null> = {};
      for (const s of spaces) {
        try {
          const p = await getGoalParents(s.id);
          Object.assign(allParents, p);
        } catch {
          // ignore
        }
      }
      return allParents;
    }
    return getGoalParents(spaceId);
  },
  ASSIGN_PROJECTS: async (msg) => {
    const settings = await getSettings();
    const targetSpace = settings.activeSpaceId === "all" ? GLOBAL_SPACE_ID : (settings.activeSpaceId ?? (await requireActiveSpaceId()));
    await setTaskProjectLinks(targetSpace, msg.goalIds, msg.projectId);
    await broadcastStateChanged();
    return null;
  },
  SET_COLOR_OVERRIDE: async (msg) => {
    const settings = await getSettings();
    const targetSpace = settings.activeSpaceId === "all" ? GLOBAL_SPACE_ID : (settings.activeSpaceId ?? (await requireActiveSpaceId()));
    await setTaskColorOverrides(targetSpace, msg.goalIds, msg.color);
    await broadcastStateChanged();
    return null;
  },
  BULK_DELETE_GOALS: async (msg) => {
    return bulkDeleteGoals(msg.goalIds);
  },
  SMART_DUPLICATE: async (msg) => {
    return smartDuplicate(msg.goalId, msg.options);
  },
  GET_GOAL_DETAILS: async (msg) => {
    const client = await api();
    return client.getGoal(msg.goalId);
  },
  SCHEDULE_GOALS: async (msg) => {
    const client = await api();
    let updated = 0;
    for (const item of msg.updates) {
      await client.updateGoal(item.goalId, { date: item.date });
      updated++;
    }
    await broadcastStateChanged();
    return { updated };
  },
  LIST_TEMPLATES: async () => (await getSpaceData(await requireActiveSpaceId())).templates ?? [],
  SAVE_TEMPLATE: async (msg) => {
    const spaceId = await requireActiveSpaceId();
    await updateSpaceData(spaceId, (d) => ({
      ...d,
      templates: [...(d.templates ?? []).filter((t) => t.id !== msg.template.id), msg.template],
    }));
    return msg.template;
  },
  DELETE_TEMPLATE: async (msg) => {
    const spaceId = await requireActiveSpaceId();
    await updateSpaceData(spaceId, (d) => ({
      ...d,
      templates: (d.templates ?? []).filter((t) => t.id !== msg.templateId),
    }));
    return null;
  },
  APPLY_TEMPLATE: async (msg) => {
    return applyTemplate(msg.templateId, msg.targetAnchorDate);
  },
  SET_TASK_TEXT_CONFIG: async (msg) => {
    const spaceId = await requireActiveSpaceId();
    await setTaskTextConfigs(spaceId, msg.goalIds, msg.patch);
    await broadcastStateChanged();
    return null;
  },
  AUTO_COMPLETE_PARENT: async (msg) => {
    const settings = await getSettings();
    if (settings.autoCompleteParent === false) {
      return { parentIdsToCheck: [], parentIdsToUncheck: [] };
    }

    let client: TimestripeApi;
    try {
      client = await api();
    } catch {
      return { parentIdsToCheck: [], parentIdsToUncheck: [] };
    }

    let goals: TSGoal[] = [];
    try {
      // Fetch across spaces so cross-horizon goals (Day -> Week -> Month) are always resolved
      const spaces = await client.listSpaces();
      const lists = await Promise.all(spaces.map((s) => client.listGoals(s.id).catch(() => [])));
      goals = lists.flat();
    } catch {
      return { parentIdsToCheck: [], parentIdsToUncheck: [] };
    }

    const byId = new Map(goals.map((g) => [g.id, g]));
    const childrenByParent = new Map<string, TSGoal[]>();
    for (const g of goals) {
      if (g.parent_id) {
        const list = childrenByParent.get(g.parent_id) ?? [];
        list.push(g);
        childrenByParent.set(g.parent_id, list);
      }
    }

    const target = byId.get(msg.goalId);
    if (!target || !target.parent_id) {
      return { parentIdsToCheck: [], parentIdsToUncheck: [] };
    }

    // Reflect the user's immediate action on the clicked goal
    target.checked = msg.checked;

    const parentIdsToCheck: string[] = [];
    const parentIdsToUncheck: string[] = [];

    if (msg.checked) {
      // =======================================================================
      // CHECK: Walk UP ancestors (Day -> Week -> Month -> Quarter -> Year -> Decade -> Life).
      // Multi-tier recursive validation: A subgoal `g` is complete if:
      //   1. g.id === msg.goalId (just checked)
      //   2. OR g.checked === true
      //   3. OR (g has subgoals and 100% of its subgoals are complete!)
      // If and only if 100% of the subgoals of an ancestor are checked, check it!
      // =======================================================================
      const isGoalDone = (g: TSGoal): boolean => {
        if (g.id === msg.goalId) return true;
        if (g.checked) return true;
        const kids = childrenByParent.get(g.id);
        if (kids && kids.length > 0) {
          return kids.every((k) => isGoalDone(k));
        }
        return false;
      };

      let currParentId: string | null = target.parent_id;
      while (currParentId) {
        const parent = byId.get(currParentId);
        if (!parent) break;

        const subgoals = childrenByParent.get(currParentId) ?? [];
        if (subgoals.length === 0) break;

        // Check if every single subgoal under this parent is checked
        const allDone = subgoals.every((s) => isGoalDone(s));
        if (allDone) {
          if (!parent.checked) {
            try {
              await client.updateGoal(parent.id, { checked: true });
              parent.checked = true;
              parentIdsToCheck.push(parent.id);
            } catch (err) {
              console.warn("[TSE] auto-complete parent failed", parent.id, err);
            }
          }
          // Move up to inspect the grandparent/higher horizons!
          currParentId = parent.parent_id;
        } else {
          // At least one sibling is unchecked: this parent cannot be complete!
          break;
        }
      }
    } else {
      // =======================================================================
      // UNCHECK: Walk UP ancestors (Full reverse cascade).
      // Since this subgoal is now unchecked, NO ancestor above it can be complete!
      // Ensure all ancestors are marked unchecked!
      // =======================================================================
      let currParentId: string | null = target.parent_id;
      while (currParentId) {
        const parent = byId.get(currParentId);
        if (!parent) break;

        if (parent.checked) {
          try {
            await client.updateGoal(parent.id, { checked: false });
          } catch (err) {
            console.warn("[TSE] auto-uncheck parent failed", parent.id, err);
          }
          parent.checked = false;
          parentIdsToUncheck.push(parent.id);
        }
        currParentId = parent.parent_id;
      }
    }

    return { parentIdsToCheck, parentIdsToUncheck };
  },
  UNCHECK_ALL_DESCENDANTS: async (msg) => {
    let client: TimestripeApi;
    try {
      client = await api();
    } catch {
      return { success: false, uncheckedIds: [] };
    }

    let goals: TSGoal[] = [];
    try {
      const spaces = await client.listSpaces();
      const lists = await Promise.all(spaces.map((s) => client.listGoals(s.id).catch(() => [])));
      goals = lists.flat();
    } catch {
      return { success: false, uncheckedIds: [] };
    }

    const childrenByParent = new Map<string, TSGoal[]>();
    for (const g of goals) {
      if (g.parent_id) {
        const list = childrenByParent.get(g.parent_id) ?? [];
        list.push(g);
        childrenByParent.set(g.parent_id, list);
      }
    }

    // Collect all descendants (children, grandchildren, etc.)
    const uncheckedIds: string[] = [];
    const queue = [msg.goalId];
    while (queue.length > 0) {
      const pId = queue.shift()!;
      const kids = childrenByParent.get(pId) ?? [];
      for (const k of kids) {
        if (k.checked) {
          uncheckedIds.push(k.id);
        }
        queue.push(k.id);
      }
    }

    // Uncheck all checked descendants
    await Promise.all(
      uncheckedIds.map((id) =>
        client.updateGoal(id, { checked: false }).catch((err) => {
          console.warn("[TSE] failed to uncheck descendant", id, err);
        }),
      ),
    );

    // Also uncheck the parent goal itself on Timestripe API
    await client.updateGoal(msg.goalId, { checked: false }).catch(() => {});

    return { success: true, uncheckedIds };
  },
  CHECK_SUBGOALS_STATUS: async (msg) => {
    let client: TimestripeApi;
    try {
      client = await api();
    } catch {
      return { hasCheckedSubgoals: false, count: 0, childIds: [] };
    }

    let goals: TSGoal[] = [];
    try {
      const spaces = await client.listSpaces();
      const lists = await Promise.all(spaces.map((s) => client.listGoals(s.id).catch(() => [])));
      goals = lists.flat();
    } catch {
      return { hasCheckedSubgoals: false, count: 0, childIds: [] };
    }

    const childrenByParent = new Map<string, TSGoal[]>();
    for (const g of goals) {
      if (g.parent_id) {
        const list = childrenByParent.get(g.parent_id) ?? [];
        list.push(g);
        childrenByParent.set(g.parent_id, list);
      }
    }

    const checkedChildIds: string[] = [];
    const queue = [msg.goalId];
    while (queue.length > 0) {
      const pId = queue.shift()!;
      const kids = childrenByParent.get(pId) ?? [];
      for (const k of kids) {
        if (k.checked) {
          checkedChildIds.push(k.id);
        }
        queue.push(k.id);
      }
    }

    return {
      hasCheckedSubgoals: checkedChildIds.length > 0,
      count: checkedChildIds.length,
      childIds: checkedChildIds,
    };
  },
  EXPORT_BACKUP: async () => {
    const aliveGoalIds = await getAliveGoalIds();
    await pruneOrphanedStorageData(aliveGoalIds);
    return generateCleanBackup();
  },
  REFRESH_BACKUP: async () => {
    const aliveGoalIds = await getAliveGoalIds();
    const pruned = await pruneOrphanedStorageData(aliveGoalIds);
    await broadcastStateChanged();
    const backup = await generateCleanBackup();
    return {
      backup,
      prunedTotal: pruned.prunedLinks + pruned.prunedOverrides + pruned.prunedTexts,
      prunedLinks: pruned.prunedLinks,
    };
  },
  IMPORT_BACKUP: async (msg) => {
    const payload = msg.payload;
    if (!payload || !payload.data) throw new Error("Invalid backup payload format");

    // Restore projects with their respective scopes
    for (const p of payload.data.projects ?? []) {
      await upsertProjectWithScope(p);
    }

    const spaceId = await requireActiveSpaceId();
    await updateSpaceData(spaceId, (current) => {
      if (msg.mode === "overwrite") {
        return {
          ...current,
          taskProjectLinks: payload.data.taskProjectLinks ?? {},
          taskColorOverrides: payload.data.taskColorOverrides ?? {},
          templates: payload.data.templates ?? [],
          taskTextConfigs: payload.data.taskTextConfigs ?? {},
        };
      } else {
        const existingTplIds = new Set((current.templates ?? []).map((t) => t.id));
        const newTemplates = (payload.data.templates ?? []).filter((t) => !existingTplIds.has(t.id));

        return {
          ...current,
          taskProjectLinks: { ...current.taskProjectLinks, ...(payload.data.taskProjectLinks ?? {}) },
          taskColorOverrides: { ...(current.taskColorOverrides ?? {}), ...(payload.data.taskColorOverrides ?? {}) },
          templates: [...(current.templates ?? []), ...newTemplates],
          taskTextConfigs: { ...(current.taskTextConfigs ?? {}), ...(payload.data.taskTextConfigs ?? {}) },
        };
      }
    });

    await broadcastStateChanged();
    return {
      restoredProjects: payload.data.projects?.length ?? 0,
      restoredTemplates: payload.data.templates?.length ?? 0,
    };
  },
  LIST_SPACES: async () => (await api()).listSpaces(),
  SET_ACTIVE_SPACE: async (msg) => {
    await setSettings({ activeSpaceId: msg.spaceId });
    await broadcastStateChanged();
    return null;
  },
  GET_PROJECTS: async () => {
    const settings = await getSettings();
    return getProjectsForSpace(settings.activeSpaceId);
  },
  CREATE_PROJECT: async (msg) => {
    const settings = await getSettings();
    // Resolve the parent FIRST from a fresh read — a sub's scope ALWAYS comes
    // from its parent (never from the active space), and a missing parent is
    // a hard error instead of a silently mis-scoped project.
    const all = await getAllProjects();
    const parent = msg.parentId ? all.find((p) => p.id === msg.parentId) : undefined;
    if (msg.parentId && !parent) throw new Error("Parent project not found");
    const targetSpace = parent
      ? (parent.spaceId ?? null)
      : (msg.spaceId !== undefined ? msg.spaceId : (settings.activeSpaceId === "all" ? null : settings.activeSpaceId));
    const project = newProject(msg.name, msg.color, targetSpace, msg.parentId ?? null);
    await upsertProjectWithScope(project);
    await broadcastStateChanged();
    return project;
  },
  UPDATE_PROJECT: async (msg) => {
    await upsertProjectWithScope(msg.project);
    // Scope is inherited down the project tree: cascade the new scope to descendants
    const all = await getAllProjects();
    const nextScope = msg.project.spaceId ?? null;
    for (const d of descendantsOf(all, msg.project.id)) {
      if ((d.spaceId ?? null) !== nextScope) {
        await upsertProjectWithScope({ ...d, spaceId: nextScope });
      }
    }
    await broadcastStateChanged();
    return msg.project;
  },
  REORDER_PROJECTS: async (msg) => {
    if (msg.projects && Array.isArray(msg.projects)) {
      for (const p of msg.projects) {
        await upsertProjectWithScope(p);
      }
      const ids = msg.projects.map((p) => p.id);
      await reorderProjectsInStorage(ids);
    } else if (msg.projectIds) {
      await reorderProjectsInStorage(msg.projectIds);
    }
    await broadcastStateChanged();
    const settings = await getSettings();
    return getProjectsForSpace(settings.activeSpaceId);
  },
  DELETE_PROJECT: async (msg) => {
    const all = await getAllProjects();
    const target = all.find((p) => p.id === msg.projectId);
    if (!target) return null;

    if (msg.mode === "promote") {
      // Lift children one level up into the deleted project's own position
      const grandparentId = target.parentId ?? null;
      for (const child of all.filter((p) => p.parentId === msg.projectId)) {
        await upsertProjectWithScope({ ...child, parentId: grandparentId });
      }
      await removeProjectEverywhere(msg.projectId);
    } else {
      // Default: cascade — the project and its whole subtree disappear together
      const ids = [msg.projectId, ...descendantsOf(all, msg.projectId).map((p) => p.id)];
      for (const id of ids) {
        await removeProjectEverywhere(id);
      }
    }
    await broadcastStateChanged();
    return null;
  },
  GET_SETTINGS: async () => getSettings(),
  SET_SETTINGS: async (msg) => {
    const next = await setSettings(msg.patch);
    if (msg.patch.colorMode !== undefined || msg.patch.showProjectName !== undefined) {
      await broadcastStateChanged();
    }
    return next;
  },
  SAVE_API_KEY: async (msg) => {
    await setApiKey(msg.apiKey.trim());
    return null;
  },
  TEST_API: async (): Promise<TestApiData> => {
    try {
      const client = await api();
      const me = await client.me();
      return { status: 200, body: `${me.first_name} ${me.last_name} (${me.email})` };
    } catch (e) {
      return { status: 0, body: String(e) };
    }
  },
};

chrome.runtime.onMessage.addListener((msg: BgMessage, _sender, sendResponse) => {
  const handler = handlers[msg?.type] as Handler | undefined;
  if (!handler) return false;
  void handler(msg)
    .then((data) => sendResponse(ok(data) as ApiResult<unknown>))
    .catch((e: unknown) => sendResponse(err(e instanceof Error ? e.message : String(e))));
  return true; // async response
});
