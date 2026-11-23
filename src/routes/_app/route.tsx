import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useRedirect } from "@/lib/use-redirect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPrivacyStatus } from "@/lib/privacy.functions";
import { PrivacyGate } from "@/components/app/PrivacyGate";
import { useEffect, useState } from "react";
import { Clock, LogOut, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { NAV_ITEMS, MOBILE_PRIMARY } from "@/components/app/nav";
import { Logo } from "@/components/app/Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePendingRequestCount } from "@/lib/use-event-requests";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

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

function AppLayout() {
  const { loading, session, profile, isManager, refresh } = useAuth();
  const signOut = useSignOut();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const pending = usePendingRequestCount().data?.total ?? 0;
  // The current privacy notice must be confirmed before the app (the server enforces it too: requireMember, RLS).
  const privacyFn = useServerFn(getPrivacyStatus);
  const privacy = useQuery({
    queryKey: ["privacy-status", session?.user.id],
    queryFn: () => privacyFn(),
    enabled: !!session && profile?.status === "active",
    staleTime: 300000,
  });

  useEffect(() => { void refresh().catch(() => undefined); }, [pathname, refresh]);

  useRedirect(!loading && !session, "/auth");

  if (loading) return <div data-testid="app-loading" className="flex min-h-screen items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  if (!session) return null;

  if (!profile || profile.status !== "active") {
    const inactive = profile?.status === "inactive";
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <div data-testid="pending-approval-screen" data-status={profile?.status ?? "pending"} className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-soft">
          <Clock className="mx-auto h-12 w-12 text-primary" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">
            {inactive ? t("navigation.inactiveTitle") : t("navigation.pendingTitle")}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {inactive ? t("navigation.inactiveText") : t("navigation.pendingText")}
          </p>
          <Button data-testid="pending-sign-out-button" variant="outline" className="mt-6 h-12 rounded-xl" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> {t("navigation.signOut")}
          </Button>
        </div>
      </div>
    );
  }

  if (privacy.isLoading) return <div data-testid="app-loading" className="flex min-h-screen items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  if (privacy.data && !privacy.data.current_accepted) return <PrivacyGate status={privacy.data} onSignOut={signOut} />;

  const items = NAV_ITEMS.filter((i) => !i.managerOnly || isManager);
  const primary = items.filter((i) => MOBILE_PRIMARY.includes(i.to));
  const more = items.filter((i) => !MOBILE_PRIMARY.includes(i.to));
  const active = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen lg:flex">
      <aside data-testid="app-sidebar" className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar p-5 text-sidebar-foreground lg:flex">
        <Logo className="mb-8 w-full" />
        <nav aria-label={t("navigation.main")} className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {items.map(({ to, testId, labelKey, icon: Icon, badge }) => (
            <Link
              key={to}
              to={to}
              data-testid={testId}
              className="flex min-h-11 items-center gap-3 rounded-xl border-l-2 border-transparent px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent data-[status=active]:border-l-sidebar-primary data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-foreground"
            >
              <Icon className="h-5 w-5" aria-hidden /> {t(labelKey)}
              {badge === "requests" && isManager && <NavCount count={pending} />}
            </Link>
          ))}
        </nav>
        <button data-testid="nav-sign-out" onClick={signOut} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent">
          <LogOut className="h-5 w-5" aria-hidden /> {t("navigation.signOut")}
        </button>
      </aside>

      <header className="sticky top-0 z-30 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
        <Logo size="sm" className="min-w-0 flex-1 text-primary" />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-10">
        <Outlet />
      </main>

      <nav data-testid="mobile-bottom-nav" aria-label={t("navigation.main")} className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {primary.map(({ to, testId, labelKey, icon: Icon }) => (
          <Link key={to} to={to} data-testid={testId} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground data-[status=active]:text-primary">
            <Icon className="h-6 w-6" aria-hidden /> {t(labelKey)}
          </Link>
        ))}
        <button
          data-testid="mobile-nav-more"
          onClick={() => setMoreOpen(true)}
          aria-label={t("navigation.more")}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${more.some((m) => active(m.to)) ? "text-primary" : "text-muted-foreground"}`}
        >
          <MoreHorizontal className="h-6 w-6" aria-hidden /> {t("navigation.more")}
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent data-testid="mobile-nav-more-sheet" side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>{t("navigation.more")}</SheetTitle></SheetHeader>
          <div className="grid gap-1 p-4 pt-0">
            {more.map(({ to, testId, labelKey, icon: Icon, badge }) => (
              <Link key={to} to={to} data-testid={testId} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted data-[status=active]:bg-secondary data-[status=active]:text-primary">
                <Icon className="h-5 w-5" aria-hidden /> {t(labelKey)}
                {badge === "requests" && isManager && <NavCount count={pending} />}
              </Link>
            ))}
            <button data-testid="mobile-nav-sign-out" onClick={signOut} className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted">
              <LogOut className="h-5 w-5" aria-hidden /> {t("navigation.signOut")}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Pending event requests next to the "Requests" menu item (hidden at zero). */
function NavCount({ count }: { count: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span data-testid="nav-requests-badge" data-count={count} className="ml-auto min-w-6 rounded-full bg-primary px-2 py-0.5 text-center text-xs font-semibold text-primary-foreground">
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{t("requests.pendingBadge", { count })}</span>
    </span>
  );
}
