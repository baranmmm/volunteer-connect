/**
 * Where sign-in may return to (?redirect=): only in-app paths of public events, never another origin. Its own module so
 * the route definitions (bundled with the app entry) do not pull in the sign-in page.
 */
export function safeRedirect(path: string) {
  return /^\/events\/[0-9a-f-]{36}$/i.test(path);
}
