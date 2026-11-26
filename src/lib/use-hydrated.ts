import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server render and during hydration, true once React runs the page in the browser. Server-rendered
 * forms disable their submit button until then: a click before hydration would otherwise submit the form natively,
 * and a native GET puts every field (email, password, phone) in the URL, its history and server logs. The forms also
 * use method="post", so even a native submit never writes them into the URL.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
