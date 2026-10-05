/**
 * Activation binding that survives hostile event environments. Some page-level
 * scripts suppress click synthesis (e.g. preventDefault on mousedown) or race
 * the click event, leaving our handlers dead. We listen to BOTH pointerup and
 * click, de-duplicated within 400ms so nothing ever double-fires.
 */
export function bindActivate(el: HTMLElement, fn: () => void): void {
  let lastFire = 0;
  const run = () => {
    const now = performance.now();
    if (now - lastFire < 400) return;
    lastFire = now;
    fn();
  };
  el.addEventListener("pointerup", run);
  el.addEventListener("click", run);
}
