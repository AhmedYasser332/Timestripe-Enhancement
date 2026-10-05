/** Timestripe API shapes (subset we consume — PRD §41.5) and extension domain types. */

export type TSHorizon = "day" | "week" | "month" | "quarter" | "year" | "decade" | "life";

export interface TSSpace {
  id: string;
  name: string;
  url: string;
}

export interface TSGoal {
  id: string;
  space_id: string;
  bucket_id: string | null;
  parent_id: string | null;
  horizon: TSHorizon | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  name: string;
  description: string;
  checked: boolean;
  color: string | null;
  url: string;
  created_datetime: string;
}

/** A user-defined project (PRD §5.3). Color is a hex string like "#7c5cff". */
export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  /** Space id this project is scoped to; null or undefined = Global (available across all spaces). */
  spaceId?: string | null;
  /** Parent project id for sub-projects; null/undefined = top level. A sub always shares its parent's scope and inherits its color when color is empty. */
  parentId?: string | null;
}

/** PRD §40 — only explicit links are stored; inherited ones are computed (PRD §7.4). */
export type TaskProjectLink = { projectId: string };

export interface TemplateNode {
  id: string; // local temporary id for parent references
  parentId: string | null;
  name: string;
  description: string;
  horizon: TSHorizon | null;
  dayOffset: number; // offset in days from anchor
  projectId?: string | null;
  colorOverride?: string | null;
}

export interface GoalTemplate {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  rootGoalName: string;
  nodes: TemplateNode[];
}

export type TextDirection = "auto" | "rtl" | "ltr";
export type TextAlignment = "left" | "center" | "right";

export interface TaskTextConfig {
  direction?: TextDirection;
  alignment?: TextAlignment;
}

export interface SpaceData {
  projects: Project[];
  taskProjectLinks: Record<string, TaskProjectLink>;
  taskColorOverrides?: Record<string, string>;
  templates?: GoalTemplate[];
  taskTextConfigs?: Record<string, TaskTextConfig>;
}

export interface Settings {
  activeSpaceId: string | null;
  colorMode: "strip" | "full";
  showProjectName: boolean;
}

export type AssignmentSource = "explicit" | "inherited";

/** Per-goal resolved assignment sent to the content script (PRD §7, §8.2, §8.3). */
export interface AssignmentInfo {
  projectId: string;
  name: string;
  /** Effective hex color (override if set, else project/ancestor color) */
  color: string;
  source: AssignmentSource;
  colorSource: "project" | "override";
  overrideColor?: string;
  /** Full sub-project chain "root › … › leaf" for tooltips. */
  path?: string;
}

export interface ViewState {
  settings: Settings;
  assignments: Record<string, AssignmentInfo>;
}
