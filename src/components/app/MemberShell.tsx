// The signed-in app shell (sidebar, bottom navigation, pending / MFA / privacy gates). Loaded only once a session
// exists, so the public event page (/events/:id, signed out) never downloads it.
import { cn } from "@/lib/utils";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPrivacyStatus } from "@/lib/privacy.functions";
import { PrivacyGate } from "@/components/app/PrivacyGate";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, LogOut, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { primaryRole, isNationalCoordinator } from "@/lib/roles";
import { MfaScreen, useMfaStatus } from "@/components/app/MfaGate";
import { useTranslation } from "react-i18next";
import {
  navItemsFor,
  forbiddenItem,
  MOBILE_PRIMARY,
  moreBadgeCount,
  type NavBadge,
  type NavItem,
} from "@/components/app/nav";
import { LogoLink } from "@/components/app/LogoLink";
import { NotificationBell } from "@/components/app/NotificationBell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useNotificationCounts } from "@/lib/use-work-notices";
import { useApprovalWaiting } from "@/lib/use-approval-waiting";
import { startInstallCapture } from "@/lib/install-app-store";
import { InstallAppNavItem, InstallAppSheet } from "@/components/app/InstallApp";

// Listen for the browser's install prompt as soon as this chunk loads (before the dashboard mounts): Chrome fires
// `beforeinstallprompt` once per page load and it is lost when nobody listens.
startInstallCapture();

function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  return async () => {
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await signOut();
    } finally {
      navigate({ to: "/auth", replace: true });
    }
  };
}

/** Rendered by the /_app layout only for a signed-in session (it handles loading and signed-out visitors). */
const WIDE_PAGES = ["/tasks"];

export function MemberShell() {
  const { loading, session, profile, roles, refresh } = useAuth();
  const signOut = useSignOut();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const mobileHeader = useAppHeaderHeight();
  // "Install app" from the More sheet: the More sheet closes and the steps open on their own; focus returns to "More".
  const [installOpen, setInstallOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  // The same total as the Requests page's "Waiting for my approval" tab.
  const waiting = useApprovalWaiting().total;
  const notices = useNotificationCounts().data;
  // Requests: everything waiting for my approval (task/meeting requests, event requests, volunteer applications and,
  // for managers, pending sign-ups and account deletion requests) plus unread decisions on my own task/meeting
  // requests; Tasks: new assignments; Meetings: meeting notices. Followers have none of these (the queries are off).
  const badgeCounts: Record<NavBadge, number> = {
    requests: waiting + (notices?.requests ?? 0),
    tasks: notices?.tasks ?? 0,
    meetings: notices?.meetings ?? 0,
  };
  // The current privacy notice must be confirmed before the app (the server enforces it too: requireMember, RLS).
  const privacyFn = useServerFn(getPrivacyStatus);
  const privacy = useQuery({
    queryKey: ["privacy-status", session?.user.id],
    queryFn: () => privacyFn(),
    enabled: !!session && profile?.status === "active",
    staleTime: 300000,
  });

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [pathname, refresh]);

  const role = primaryRole(roles);
  const nc = isNationalCoordinator(roles);
  const mfa = useMfaStatus(nc && !loading, session?.user.id);

  if (loading || !session)
    return (
      <div
        data-testid="app-loading"
        className="flex min-h-screen items-center justify-center text-muted-foreground"
      >
        {t("common.loading")}
      </div>
    );

  if (!profile || profile.status !== "active") {
    const inactive = profile?.status === "inactive";
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <div
          data-testid="pending-approval-screen"
          data-status={profile?.status ?? "pending"}
          className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-soft"
        >
          <Clock className="mx-auto h-12 w-12 text-primary" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">
            {inactive ? t("navigation.inactiveTitle") : t("navigation.pendingTitle")}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {inactive ? t("navigation.inactiveText") : t("navigation.pendingText")}
          </p>
          <Button
            data-testid="pending-sign-out-button"
            variant="outline"
            className="mt-6 h-12 rounded-xl"
            onClick={signOut}
          >
            <LogOut className="mr-2 h-4 w-4" /> {t("navigation.signOut")}
          </Button>
        </div>
      </div>
    );
  }

  // National Coordinators act only with MFA (aal2): until then they see only the set-up / verification screen.
  if (nc && (mfa.isLoading || !mfa.data))
    return (
      <div
        data-testid="app-loading"
        className="flex min-h-screen items-center justify-center text-muted-foreground"
      >
        {t("common.loading")}
      </div>
    );
  if (nc && mfa.data && !mfa.data.aal2)
    return <MfaScreen factorId={mfa.data.factorId} userId={session.user.id} onSignOut={signOut} />;

  if (privacy.isLoading)
    return (
      <div
        data-testid="app-loading"
        className="flex min-h-screen items-center justify-center text-muted-foreground"
      >
        {t("common.loading")}
      </div>
    );
  if (privacy.data && !privacy.data.current_accepted)
    return <PrivacyGate status={privacy.data} onSignOut={signOut} />;

  // Pages a role may not open go back to the dashboard (their data is refused by the server as well).
  if (forbiddenItem(role, pathname)) return <Navigate to="/dashboard" replace />;

  const items = navItemsFor(role);
  const primary = items.filter((i) => MOBILE_PRIMARY.includes(i.to)).slice(0, 4);
  const more = items.filter((i) => !primary.includes(i));
  const moreCount = moreBadgeCount(more, badgeCounts);
  const active = (to: string) => pathname === to || pathname.startsWith(to + "/");
  // Pages that use the whole content width (boards and long rows); every other page keeps the reading width.
  const wide = WIDE_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const width = wide ? "max-w-none" : "max-w-5xl";

  return (
    <div className="min-h-screen lg:flex">
      <aside
        data-testid="app-sidebar"
        className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar p-5 text-sidebar-foreground lg:flex"
      >
        <LogoLink className="mb-8 w-full" />
        <nav
          aria-label={t("navigation.main")}
          className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              className="flex min-h-11 items-center gap-3 rounded-xl border-l-2 border-transparent px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent data-[status=active]:border-l-sidebar-primary data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-foreground"
            >
              {item.badge && <NavCount kind={item.badge} count={badgeCounts[item.badge]} />}
            </NavLink>
          ))}
        </nav>
        <InstallAppNavItem className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent" />
        <button
          data-testid="nav-sign-out"
          onClick={signOut}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <LogOut className="h-5 w-5" aria-hidden /> {t("navigation.signOut")}
        </button>
      </aside>

      <header
        ref={mobileHeader}
        className="sticky top-0 z-30 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur lg:hidden"
      >
        <LogoLink size="sm" className="min-w-0 flex-1 text-primary" />
        <NotificationBell variant="sheet" />
      </header>

      <div className="min-w-0 flex-1">
        {/* Desktop top bar: the notification bell, top-right above the page. */}
        <header
          data-testid="app-top-bar"
          className={cn("mx-auto hidden w-full justify-end px-10 pt-4 lg:flex", width)}
        >
          <NotificationBell variant="popover" />
        </header>
        <main
          data-width={wide ? "wide" : "default"}
          className={cn(
            "mx-auto w-full flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-2",
            width,
          )}
        >
          <Outlet />
        </main>
      </div>

      <nav
        data-testid="mobile-bottom-nav"
        aria-label={t("navigation.main")}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {primary.map(({ to, testId, labelKey, icon: Icon, badge }) => (
          <Link
            key={to}
            to={to}
            data-testid={testId}
            className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground data-[status=active]:text-primary"
          >
            <span className="relative">
              <Icon className="h-6 w-6" aria-hidden />
              {badge && (
                <NavCount
                  kind={badge}
                  count={badgeCounts[badge]}
                  testId={`mobile-nav-${badge}-badge`}
                  className="absolute -right-3 -top-2 min-w-5 px-1.5 py-0 text-[0.65rem] leading-4"
                />
              )}
            </span>
            <span className="max-w-full truncate px-1">{t(labelKey)}</span>
          </Link>
        ))}
        <button
          ref={moreButton}
          data-testid="mobile-nav-more"
          onClick={() => setMoreOpen(true)}
          aria-label={
            moreCount
              ? `${t("navigation.more")}, ${t("notifications.badges.more", { count: moreCount })}`
              : t("navigation.more")
          }
          className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${more.some((m) => active(m.to)) ? "text-primary" : "text-muted-foreground"}`}
        >
          <span className="relative">
            <MoreHorizontal className="h-6 w-6" aria-hidden />
            {moreCount > 0 && (
              <span
                aria-hidden
                data-testid="mobile-nav-more-badge"
                data-count={moreCount}
                className="absolute -right-3 -top-2 min-w-5 rounded-full bg-primary px-1.5 py-0 text-center text-[0.65rem] font-semibold leading-4 text-primary-foreground"
              >
                {moreCount > 99 ? "99+" : moreCount}
              </span>
            )}
          </span>
          {t("navigation.more")}
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent data-testid="mobile-nav-more-sheet" side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>{t("navigation.more")}</SheetTitle>
          </SheetHeader>
          <div className="grid gap-1 p-4 pt-0">
            {more.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                onClick={() => setMoreOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted data-[status=active]:bg-secondary data-[status=active]:text-primary"
              >
                {item.badge && <NavCount kind={item.badge} count={badgeCounts[item.badge]} />}
              </NavLink>
            ))}
            <InstallAppNavItem
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted"
              onOpenSheet={() => {
                setMoreOpen(false);
                setInstallOpen(true);
              }}
            />
            <button
              data-testid="mobile-nav-sign-out"
              onClick={signOut}
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted"
            >
              <LogOut className="h-5 w-5" aria-hidden /> {t("navigation.signOut")}
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <InstallAppSheet
        open={installOpen}
        onOpenChange={setInstallOpen}
        returnFocus={() => moreButton.current?.focus()}
      />
    </div>
  );
}

/**
 * Publishes the phone top bar's height as `--app-header-h` (0 where it is hidden), so page headers can stick right
 * below it (CompactHeader).
 */
function useAppHeaderHeight() {
  return useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-header-h");
    };
  }, []);
}

/** A menu entry: an in-app link, or an external one (Donate) that opens in a new tab. */
function NavLink({
  item,
  className,
  onClick,
  children,
}: {
  item: NavItem;
  className: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const body = (
    <>
      <Icon className="h-5 w-5" aria-hidden /> {t(item.labelKey)}
      {children}
    </>
  );
  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={item.testId}
        onClick={onClick}
        className={className}
      >
        {body}
        <span className="sr-only"> {t("common.opensInNewTab")}</span>
      </a>
    );
  }
  return (
    <Link to={item.to} data-testid={item.testId} onClick={onClick} className={className}>
      {body}
    </Link>
  );
}

/** A count next to a menu item (hidden at zero): `nav-<kind>-badge` (`mobile-nav-<kind>-badge` in the bottom bar). */
function NavCount({
  kind,
  count,
  testId,
  className,
}: {
  kind: NavBadge;
  count: number;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span
      data-testid={testId ?? `nav-${kind}-badge`}
      data-count={count}
      className={
        className
          ? `rounded-full bg-primary text-center font-semibold text-primary-foreground ${className}`
          : "ml-auto min-w-6 rounded-full bg-primary px-2 py-0.5 text-center text-xs font-semibold text-primary-foreground"
      }
    >
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{t(`notifications.badges.${kind}`, { count })}</span>
    </span>
  );
}
