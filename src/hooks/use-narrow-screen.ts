import { useSyncExternalStore } from "react";

/** Below Tailwind's `sm` breakpoint (640px): phones get the compact page toolbars. */
export const NARROW_QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia?.(NARROW_QUERY);
  // Older browsers (and some test doubles) only have addListener.
  if (mql?.addEventListener) {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  if (mql?.addListener) {
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }
  return () => undefined;
}
const snapshot = () => !!window.matchMedia?.(NARROW_QUERY).matches;
const serverSnapshot = () => false;

/**
 * True on screens narrower than 640px. Read synchronously on the first client render (these pages are client-only),
 * so a phone never flashes the desktop toolbar; the server (and jsdom without matchMedia) sees a wide screen.
 */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
