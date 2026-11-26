import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogoLink } from "@/components/app/LogoLink";
import { LanguageToggle } from "@/components/app/LanguageToggle";
import { useAuth } from "@/lib/auth";
import { publicNavItems, publicNavPage, type PublicNavPage } from "@/lib/public-nav";

const ITEM =
  "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium hover:text-primary sm:px-3 aria-[current=page]:text-primary aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8";
const BUTTON =
  "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md bg-primary px-3 text-sm sm:px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90";

/**
 * The one top bar of every signed-out page (/, /join, /sign-in, /auth, /reset-password, /events, event pages, the
 * privacy notices and the email-link pages): the logo (home), Events, Sign in, Join and the language switch. The item
 * of the page you are on is hidden (Join on the join page, Sign in on the sign-in page) or marked (Events on /events,
 * aria-current="page"). `current` overrides the address (the /auth page knows its own form); `account={false}` leaves
 * out the account links (the National Coordinator's MFA prompt, where Dashboard is not open yet).
 *
 * Server-rendered pages never know the session: the HTML has Sign in and Join, hidden before the first paint for a
 * stored session ([data-signed-out-only]); a signed-in member then gets Dashboard instead. One sticky row, 61 px high
 * on every width (AuthPage and the /events map story stick below it); phones show the logo mark only and a compact
 * language switch, so the Turkish labels fit 360-390 px without sideways scrolling.
 */
export function PublicTopBar({
  current,
  account = true,
}: {
  current?: PublicNavPage | null;
  account?: boolean;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });
  const page = current === undefined ? publicNavPage(pathname) : current;
  const items = publicNavItems(page);
  return (
    <header
      data-testid="public-topbar"
      data-current={page ?? undefined}
      className="sticky top-0 z-40 border-b bg-card/95 text-foreground [color-scheme:light] backdrop-blur supports-[backdrop-filter]:bg-card/85"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2 sm:gap-3 sm:px-6">
        <LogoLink size="sm" phoneMarkOnly className="shrink-0" />
        <nav
          aria-label={t("landing.nav.label")}
          className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-2"
        >
          <Link
            to="/events"
            data-testid="public-topbar-events"
            // The router marks a link active (aria-current) for its sub-pages too: only /events itself is current.
            activeOptions={{ exact: true, includeSearch: false, includeHash: false }}
            aria-current={items.eventsCurrent ? "page" : undefined}
            className={ITEM}
          >
            {t("landing.nav.events")}
          </Link>
          {account && session ? (
            <Link
              to="/dashboard"
              data-testid="public-topbar-dashboard"
              activeOptions={{ exact: true }}
              className={BUTTON}
            >
              {t("navigation.dashboard")}
            </Link>
          ) : account ? (
            <>
              {items.showSignIn && (
                <Link
                  to="/sign-in"
                  data-testid="public-topbar-sign-in"
                  activeOptions={{ exact: true }}
                  data-signed-out-only=""
                  className={ITEM}
                >
                  {t("landing.nav.signIn")}
                </Link>
              )}
              {items.showJoin && (
                <Link
                  to="/"
                  data-testid="public-topbar-join"
                  activeOptions={{ exact: true }}
                  data-signed-out-only=""
                  className={BUTTON}
                >
                  {t("landing.nav.join")}
                </Link>
              )}
            </>
          ) : null}
        </nav>
        <LanguageToggle compact className="shrink-0" />
      </div>
    </header>
  );
}
