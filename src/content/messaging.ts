/** Shared helper for content-script → service-worker calls. Distinguishes failure from a null result. */

import type { ApiResult } from "../shared/messages";

export async function sendToBg<T>(message: unknown): Promise<ApiResult<T> | null> {
  const res = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
  if (!res) {
    console.warn("[TSE] no response from service worker");
    return null;
  }
  return res;
}
