import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogoLink } from "@/components/app/LogoLink";
import { LanguageToggle } from "@/components/app/LanguageToggle";
import { useAuth } from "@/lib/auth";
import { publicNavItems, publicNavPage, type PublicNavPage } from "@/lib/public-nav";

const ITEM =
  "inline-flex min-h-11 items-center rounded-md px-2.5 text-sm font-medium hover:text-primary sm:px-3 aria-[current=page]:text-primary aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8";
const BUTTON =
  "inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";

/**
 * The one top bar of every signed-out page (/, /join, /sign-in, /auth, /reset-password, /events, event pages, the
 * privacy notices and the email-link pages): the logo (home), Events, Sign in, Join and the language switch. The item
 * of the page you are on is hidden (Join on the join page, Sign in on the sign-in page) or marked (Events on /events,
 * aria-current="page"). `current` overrides the address (the /auth page knows its own form); `account={false}` leaves
 * out the account links (the National Coordinator's MFA prompt, where Dashboard is not open yet).
 *
 * Server-rendered pages never know the session: the HTML has Sign in and Join, hidden before the first paint for a
 * stored session ([data-signed-out-only]); a signed-in member then gets Dashboard instead. Phones: two rows (logo and
 * language, then the links) so nothing scrolls sideways at 390 px; from 640 px one row (61 px high, see AuthPage).
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
      className="z-40 border-b bg-card/95 text-foreground [color-scheme:light] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:sticky sm:top-0"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:flex-nowrap sm:gap-3 sm:px-6">
        <LogoLink size="sm" className="min-w-0 flex-1 sm:flex-none" />
        <nav
          aria-label={t("landing.nav.label")}
          className="order-last -ml-2.5 flex w-full min-w-0 items-center gap-1 sm:order-none sm:ml-auto sm:w-auto sm:gap-2"
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
              className={`${BUTTON} ml-auto sm:ml-0`}
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
                  className={`${BUTTON} ml-auto sm:ml-0`}
                >
                  {t("landing.nav.join")}
                </Link>
              )}
            </>
          ) : null}
        </nav>
        <LanguageToggle className="shrink-0" />
      </div>
    </header>
  );
}
