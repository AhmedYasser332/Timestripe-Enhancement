/** Shared self-contained service-worker fetch mock used by the E2E harness. */

export const MOCK_SPACES = [
  { id: "sp1", name: "دنيا" },
  { id: "sp2", name: "EXT-TEST" },
];

export const MOCK_GOALS = [
  { id: "AAAAAAAA", name: "7:30 to 12:45", date: "2026-10-05", space_id: "sp1", parent_id: null },
  { id: "BBBBBBBB", name: "1.5 hrs Medo", date: "2026-10-06", space_id: "sp1", parent_id: null },
  { id: "CCCCCCCC", name: "1.0 hrs Next.js", date: null, space_id: "sp1", parent_id: null },
  { id: "DDDDDDDD", name: "0.5 hrs Business", date: "2026-10-10", space_id: "sp2", parent_id: null },
  { id: "EEEEEEEE", name: "مراجعة النص الثقيل من البرزة", date: null, space_id: "sp1", parent_id: null },
];

/** Fully self-contained fetch replacement evaluated INSIDE the service worker. */
export function buildSwPatch(spaces = MOCK_SPACES, goals = MOCK_GOALS) {
  return `
(() => {
  if (self.__mockInstalled) return;
  self.__mockInstalled = true;
  self.__mockHits = 0;
  const spaces = ${JSON.stringify(spaces)};
  const goals = ${JSON.stringify(goals)};

  function handler(pathname, method, bodyObj) {
    self.__mockHits++;
    if (pathname.endsWith("users/me/")) {
      return { status: 200, body: { id: "u1", email: "t@t.com", first_name: "Test", last_name: "User" } };
    }
    if (pathname.endsWith("spaces/")) return { status: 200, body: { results: spaces } };
    if (pathname.startsWith("goals/") && pathname.includes("space_id=")) {
      return { status: 200, body: { results: goals, next: null } };
    }
    const m = /^goals\\/([A-Za-z0-9]{8})\\/?$/.exec(pathname);
    if (m) {
      const goal = goals.find((g) => g.id === m[1]);
      if (method === "GET") return goal ? { status: 200, body: goal } : { status: 404, body: {} };
      if (method === "PATCH" && goal && bodyObj) { Object.assign(goal, bodyObj); return { status: 200, body: goal }; }
      if (method === "DELETE") {
        return { status: 204, body: "" };
      }
    }
    if (pathname === "goals/" && method === "POST" && bodyObj) {
      const id = Math.random().toString(36).slice(2, 6).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const goal = { id, name: "", date: null, space_id: "sp1", parent_id: null, ...bodyObj };
      goals.push(goal);
      return { status: 201, body: goal };
    }
    return { status: 404, body: {} };
  }

  const realFetch = self.fetch.bind(self);
  self.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = /^https:\\/\\/timestripe\\.com\\/api\\/v3\\/(.*)$/.exec(url);
    if (m) {
      const method = (init?.method ?? "GET").toUpperCase();
      let bodyObj = null;
      if (init?.body) { try { bodyObj = JSON.parse(init.body); } catch { bodyObj = null; } }
      const { status, body } = handler(m[1], method, bodyObj);
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return realFetch(input, init);
  };
})();
`;
}

export const SEED_STORAGE = `
  async () => {
    await chrome.storage.local.set({
      apiKey: "test-key",
      settings: { activeSpaceId: "sp1", colorMode: "strip", showProjectName: true },
      "data:sp1": {
        projects: [
          { id: "proj1", name: "Work", color: "#00A8FF", spaceId: "sp1" },
          { id: "proj2", name: "Life", color: "#00E676", spaceId: null },
        ],
        taskProjectLinks: {},
        taskColorOverrides: {},
      },
      "data:global": { projects: [], taskProjectLinks: {}, taskColorOverrides: {} },
    });
  }
`;


