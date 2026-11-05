/** Shared helper for content-script → service-worker calls. Distinguishes failure from a null result. */

import type { ApiResult } from "../shared/messages";

export async function sendToBg<T>(message: unknown): Promise<ApiResult<T> | null> {
  if (!chrome.runtime?.id) {
    return null;
  }
  try {
    const res = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
    if (!res) {
      return null;
    }
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("context invalidated") || msg.includes("Extension context invalidated")) {
      // Content script was orphaned by an extension reload/update in chrome://extensions.
      return null;
    }
    console.warn("[TSE] sendToBg failed", err);
    return null;
  }
}
