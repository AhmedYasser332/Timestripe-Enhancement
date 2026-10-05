/**
 * Universal Action History (Undo / Redo Stack) (PRD §51).
 * Captures all extension operations:
 * - Project assignment & removal
 * - Color override & reset
 * - Smart Duplicate (undo deletes created root, cascading to all subgoals)
 * - Bulk Delete (undo restores deleted goals)
 * - Global Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo) shortcuts.
 */

import { showToast } from "./toast";

export interface HistoryAction {
  id: string;
  description: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

const undoStack: HistoryAction[] = [];
const redoStack: HistoryAction[] = [];
const MAX_HISTORY = 40;

export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

export function pushAction(action: HistoryAction): void {
  undoStack.push(action);
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  // Any new user action invalidates redo branch
  redoStack.length = 0;
}

export async function undo(): Promise<boolean> {
  const action = undoStack.pop();
  if (!action) {
    showToast("Nothing to undo");
    return false;
  }

  try {
    await action.undo();
    redoStack.push(action);
    showToast(`Undid: ${action.description}`);
    return true;
  } catch (e) {
    showToast(`Undo failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function redo(): Promise<boolean> {
  const action = redoStack.pop();
  if (!action) {
    showToast("Nothing to redo");
    return false;
  }

  try {
    await action.redo();
    undoStack.push(action);
    showToast(`Redid: ${action.description}`);
    return true;
  } catch (e) {
    showToast(`Redo failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  return Boolean(el.closest('[contenteditable="true"], input, textarea'));
}

export function initGlobalHistoryShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // Ignore when typing inside input / editor
    if (isTextInput(document.activeElement)) return;

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (!isCtrlOrMeta) return;

    const key = e.key.toLowerCase();
    const code = e.code;

    // Ctrl+Z or Cmd+Z (supports English Z, physical KeyZ, and Arabic ئ)
    if (code === "KeyZ" || key === "z" || key === "ئ") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        void redo();
      } else {
        void undo();
      }
      return;
    }

    // Ctrl+Y or Cmd+Y (supports English Y, physical KeyY, and Arabic غ)
    if (code === "KeyY" || key === "y" || key === "غ") {
      e.preventDefault();
      e.stopPropagation();
      void redo();
      return;
    }
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
}
