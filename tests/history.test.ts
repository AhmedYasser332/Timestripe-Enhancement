import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearHistory, pushAction, redo, undo } from "../src/content/history";

describe("Universal History Engine (Ctrl+Z / Ctrl+Y) (PRD §51)", () => {
  beforeEach(() => {
    clearHistory();
  });

  it("executes undo and redo in sequence", async () => {
    let state = 0;
    const action = {
      id: "a1",
      description: "Increment",
      undo: () => {
        state--;
      },
      redo: () => {
        state++;
      },
    };

    state = 1;
    pushAction(action);

    // Undo should restore state to 0
    const undoResult = await undo();
    expect(undoResult).toBe(true);
    expect(state).toBe(0);

    // Redo should bring state back to 1
    const redoResult = await redo();
    expect(redoResult).toBe(true);
    expect(state).toBe(1);
  });

  it("returns false when nothing is in the stack", async () => {
    expect(await undo()).toBe(false);
    expect(await redo()).toBe(false);
  });

  it("clears redo stack when a new action is pushed", async () => {
    let state = "initial";
    pushAction({
      id: "1",
      description: "First",
      undo: () => {
        state = "initial";
      },
      redo: () => {
        state = "first";
      },
    });

    state = "first";
    await undo();
    expect(state).toBe("initial");

    // Push new action after undo
    pushAction({
      id: "2",
      description: "Branch",
      undo: () => {
        state = "initial";
      },
      redo: () => {
        state = "branch";
      },
    });

    // Old redo is now invalidated
    const redoResult = await redo();
    expect(redoResult).toBe(false);
  });

  it("handles failing undo gracefully without throwing", async () => {
    pushAction({
      id: "fail",
      description: "Broken action",
      undo: () => {
        throw new Error("API network failure");
      },
      redo: vi.fn(),
    });

    const result = await undo();
    expect(result).toBe(false);
  });
});
