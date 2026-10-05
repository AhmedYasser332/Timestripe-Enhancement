/** Minimal Timestripe-style toast feedback for in-page actions. */

import { hexToRgbTriple } from "../shared/colors";

const HOST_ID = "tse-toast-host";

export function showToast(
  message: string,
  colorHex?: string,
  durationMs = 2400,
  onAction?: () => void,
  actionLabel = "Undo",
): void {
  if (typeof document === "undefined") return;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    const style = document.createElement("style");
    style.textContent = `
      #${HOST_ID} {
        position: fixed;
        bottom: 84px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        z-index: 2147483647;
        pointer-events: none;
      }
      .tse-toast {
        background: rgba(24, 24, 26, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-inline-start: 3px solid rgb(var(--tse-color, 39, 141, 234));
        color: #ececec;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 12.5px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.18s ease, transform 0.18s ease;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .tse-toast-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .tse-toast-action {
        background: rgba(255, 255, 255, 0.12);
        border: none;
        border-radius: 4px;
        color: #f4f4f5;
        font-size: 11.5px;
        font-weight: 600;
        padding: 3px 8px;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .tse-toast-action:hover {
        background: rgba(255, 255, 255, 0.22);
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "tse-toast";
  el.dir = "auto";

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  el.appendChild(msgSpan);

  if (colorHex) {
    const [r, g, b] = hexToRgbTriple(colorHex);
    el.style.setProperty("--tse-color", `${r}, ${g}, ${b}`);
  }

  if (onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tse-toast-action";
    btn.textContent = actionLabel;
    btn.onclick = () => {
      onAction();
      el.remove();
    };
    el.appendChild(btn);
  }

  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("tse-toast-visible"));
  setTimeout(() => {
    el.classList.remove("tse-toast-visible");
    setTimeout(() => el.remove(), 220);
  }, durationMs);
}
