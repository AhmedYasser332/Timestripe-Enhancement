/** Project inheritance resolution (PRD §7): explicit links win, otherwise walk up the parent chain. */

import type { AssignmentSource } from "./types";

export interface ResolvedAssignment {
  projectId: string;
  source: AssignmentSource;
}

/**
 * @param parents goalId → parent goalId (null for roots), for every known goal of the space
 * @param links explicit goalId → project links
 */
export function resolveAssignments(
  parents: Record<string, string | null>,
  links: Record<string, { projectId: string }>,
): Record<string, ResolvedAssignment> {
  const cache = new Map<string, ResolvedAssignment | null>();
  const visiting = new Set<string>();

  const resolve = (id: string): ResolvedAssignment | null => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return null; // cycle guard — shouldn't happen, but never hang

    visiting.add(id);
    let out: ResolvedAssignment | null = null;
    const link = links[id];
    if (link) {
      out = { projectId: link.projectId, source: "explicit" };
    } else {
      const parent = parents[id];
      const parentRes = parent ? resolve(parent) : null;
      if (parentRes) out = { projectId: parentRes.projectId, source: "inherited" };
    }
    visiting.delete(id);
    cache.set(id, out);
    return out;
  };

  const result: Record<string, ResolvedAssignment> = {};
  for (const id of new Set([...Object.keys(parents), ...Object.keys(links)])) {
    const res = resolve(id);
    if (res) result[id] = res;
  }
  return result;
}
