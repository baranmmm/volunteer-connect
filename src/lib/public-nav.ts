/** The public top bar's own pages: the item of the page you are on is hidden (Join, Sign in) or marked (Events). */
export type PublicNavPage = "join" | "sign-in" | "events";

/** Which top bar item is the current page, from the address (/ and /join are the join page). */
export function publicNavPage(pathname: string): PublicNavPage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "/join") return "join";
  if (path === "/sign-in") return "sign-in";
  if (path === "/events") return "events";
  return null;
}

/** What the bar shows for a page: signed-in members get Dashboard instead of Sign in and Join. */
export function publicNavItems(current: PublicNavPage | null) {
  return {
    eventsCurrent: current === "events",
    showSignIn: current !== "sign-in",
    showJoin: current !== "join",
  };
}
