/** Typed client for the official Timestripe API (PRD §41). Runs in the service worker only. */

import type { TSGoal, TSSpace } from "./types";

export class TimestripeApi {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://timestripe.com/api/v3/",
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Timestripe API ${res.status} on ${path}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async me(): Promise<{ id: string; email: string; first_name: string; last_name: string }> {
    return this.request("users/me/");
  }

  async listSpaces(): Promise<TSSpace[]> {
    const page = await this.request<{ results: TSSpace[] }>("spaces/");
    return page.results;
  }

  /** Fetch all goals of a space, following pagination. */
  async listGoals(spaceId: string): Promise<TSGoal[]> {
    interface GoalPage {
      results: TSGoal[];
      next: string | null;
    }
    const all: TSGoal[] = [];
    let path = `goals/?space_id=${encodeURIComponent(spaceId)}&limit=100`;
    for (;;) {
      const page: GoalPage = await this.request<GoalPage>(path);
      all.push(...page.results);
      if (!page.next) break;
      // `next` is absolute; keep only the path after /api/v3/
      const u = new URL(page.next);
      path = u.pathname.replace(/^\/api\/v3\//, "") + u.search;
    }
    return all;
  }

  async getGoal(goalId: string): Promise<TSGoal> {
    return this.request<TSGoal>(`goals/${encodeURIComponent(goalId)}/`);
  }

  async createGoal(payload: Partial<TSGoal>): Promise<TSGoal> {
    return this.request<TSGoal>("goals/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateGoal(goalId: string, patch: Partial<TSGoal>): Promise<TSGoal> {
    return this.request<TSGoal>(`goals/${encodeURIComponent(goalId)}/`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async deleteGoal(goalId: string): Promise<void> {
    return this.request<void>(`goals/${encodeURIComponent(goalId)}/`, {
      method: "DELETE",
    });
  }
}
