/** Message contracts between popup, content script and service worker (typed). */

import type {
  AssignmentInfo,
  GoalTemplate,
  Project,
  Settings,
  SpaceData,
  TaskTextConfig,
  TSGoal,
  TSSpace,
  ViewState,
} from "./types";

export interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  spaceId: string;
  data: SpaceData;
}

export interface DuplicateOptions {
  scope: "main" | "tree";
  copyProject: boolean;
  copyColors: boolean;
  copyNotes: boolean;
  copyHorizon: boolean;
  copyDates: boolean;
  copyCompletion: boolean;
  targetAnchorDate?: string | null; // YYYY-MM-DD
}

export interface BulkDeleteResult {
  completed: number;
  failed: number;
  errors: string[];
}

export interface SmartDuplicateResult {
  newRootId: string;
  totalCreated: number;
}

// ---------- content script → service worker ----------

export type GetViewStateMessage = { type: "GET_VIEW_STATE" };
export type GetGoalIndexMessage = { type: "GET_GOAL_INDEX"; spaceId?: string };
export type AssignProjectsMessage = { type: "ASSIGN_PROJECTS"; goalIds: string[]; projectId: string | null };
export type SetColorOverrideMessage = { type: "SET_COLOR_OVERRIDE"; goalIds: string[]; color: string | null };
export type BulkDeleteGoalsMessage = { type: "BULK_DELETE_GOALS"; goalIds: string[] };
export type SmartDuplicateMessage = { type: "SMART_DUPLICATE"; goalId: string; options: DuplicateOptions };
export type GetGoalDetailsMessage = { type: "GET_GOAL_DETAILS"; goalId: string };
export type ScheduleGoalsMessage = {
  type: "SCHEDULE_GOALS";
  updates: Array<{ goalId: string; date: string | null }>;
};
export type ListTemplatesMessage = { type: "LIST_TEMPLATES" };
export type SaveTemplateMessage = { type: "SAVE_TEMPLATE"; template: GoalTemplate };
export type DeleteTemplateMessage = { type: "DELETE_TEMPLATE"; templateId: string };
export type ApplyTemplateMessage = { type: "APPLY_TEMPLATE"; templateId: string; targetAnchorDate: string };
export type SetTaskTextConfigMessage = {
  type: "SET_TASK_TEXT_CONFIG";
  goalIds: string[];
  patch: Partial<TaskTextConfig> | null;
};
export type AutoCompleteParentMessage = {
  type: "AUTO_COMPLETE_PARENT";
  goalId: string;
  checked: boolean;
};
export type AutoCompleteParentResult = {
  parentIdsToCheck: string[];
  parentIdsToUncheck: string[];
};
export type ExportBackupMessage = { type: "EXPORT_BACKUP" };
export type RefreshBackupMessage = { type: "REFRESH_BACKUP" };
export type ImportBackupMessage = {
  type: "IMPORT_BACKUP";
  payload: BackupPayload;
  mode: "merge" | "overwrite";
};

// ---------- popup → service worker ----------

export type ListSpacesMessage = { type: "LIST_SPACES" };
export type SetActiveSpaceMessage = { type: "SET_ACTIVE_SPACE"; spaceId: string };
export type GetProjectsMessage = { type: "GET_PROJECTS" };
export type CreateProjectMessage = {
  type: "CREATE_PROJECT";
  name: string;
  color: string;
  spaceId?: string | null;
  parentId?: string | null;
};
export type UpdateProjectMessage = { type: "UPDATE_PROJECT"; project: Project };
export type ReorderProjectsMessage = { type: "REORDER_PROJECTS"; projectIds?: string[]; projects?: Project[] };
/** mode: "cascade" removes the project AND every descendant; "promote" removes only the project and lifts its children one level up. */
export type DeleteProjectMessage = { type: "DELETE_PROJECT"; projectId: string; mode?: "cascade" | "promote" };
export type GetSettingsMessage = { type: "GET_SETTINGS" };
export type SetSettingsMessage = { type: "SET_SETTINGS"; patch: Partial<Settings> };
export type SaveApiKeyMessage = { type: "SAVE_API_KEY"; apiKey: string };
export type TestApiMessage = { type: "TEST_API" };

// ---------- service worker → content script ----------

export type StateChangedMessage = { type: "STATE_CHANGED" };

export type ContentScriptMessage = StateChangedMessage;

export type BgMessage =
  | GetViewStateMessage
  | GetGoalIndexMessage
  | AssignProjectsMessage
  | SetColorOverrideMessage
  | BulkDeleteGoalsMessage
  | SmartDuplicateMessage
  | GetGoalDetailsMessage
  | ScheduleGoalsMessage
  | ListTemplatesMessage
  | SaveTemplateMessage
  | DeleteTemplateMessage
  | ApplyTemplateMessage
  | SetTaskTextConfigMessage
  | AutoCompleteParentMessage
  | ExportBackupMessage
  | RefreshBackupMessage
  | ImportBackupMessage
  | ListSpacesMessage
  | SetActiveSpaceMessage
  | GetProjectsMessage
  | CreateProjectMessage
  | UpdateProjectMessage
  | ReorderProjectsMessage
  | DeleteProjectMessage
  | GetSettingsMessage
  | SetSettingsMessage
  | SaveApiKeyMessage
  | TestApiMessage;

// ---------- responses ----------

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export interface ViewSettingsData {
  settings: Settings;
  assignments: Record<string, AssignmentInfo>;
}

export interface TestApiData {
  status: number;
  body: string;
}

export type BgResponseMap = {
  GET_VIEW_STATE: ViewState;
  GET_GOAL_INDEX: Record<string, string | null>;
  ASSIGN_PROJECTS: null;
  SET_COLOR_OVERRIDE: null;
  BULK_DELETE_GOALS: BulkDeleteResult;
  SMART_DUPLICATE: SmartDuplicateResult;
  GET_GOAL_DETAILS: TSGoal;
  SCHEDULE_GOALS: { updated: number };
  LIST_TEMPLATES: GoalTemplate[];
  SAVE_TEMPLATE: GoalTemplate;
  DELETE_TEMPLATE: null;
  APPLY_TEMPLATE: SmartDuplicateResult;
  SET_TASK_TEXT_CONFIG: null;
  AUTO_COMPLETE_PARENT: AutoCompleteParentResult;
  EXPORT_BACKUP: BackupPayload;
  REFRESH_BACKUP: { backup: BackupPayload; prunedTotal: number; prunedLinks: number };
  IMPORT_BACKUP: { restoredProjects: number; restoredTemplates: number };
  LIST_SPACES: TSSpace[];
  SET_ACTIVE_SPACE: null;
  GET_PROJECTS: Project[];
  CREATE_PROJECT: Project;
  UPDATE_PROJECT: Project;
  REORDER_PROJECTS: Project[];
  DELETE_PROJECT: null;
  GET_SETTINGS: Settings;
  SET_SETTINGS: Settings;
  SAVE_API_KEY: null;
  TEST_API: TestApiData;
};

export function err(error: string): ApiErr {
  return { ok: false, error };
}

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
