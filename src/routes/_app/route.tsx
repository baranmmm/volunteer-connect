import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useRedirect } from "@/lib/use-redirect";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Clock, LogOut, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NAV_ITEMS, MOBILE_PRIMARY } from "@/components/app/nav";
import { Logo } from "@/components/app/Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => { void refresh().catch(() => undefined); }, [pathname, refresh]);

  useRedirect(!loading && !session, "/auth");

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (!session) return null;

  if (!profile || profile.status !== "active") {
    const inactive = profile?.status === "inactive";
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-soft">
          <Clock className="mx-auto h-12 w-12 text-primary" aria-hidden />
          <h1 className="mt-4 text-2xl font-semibold">
            {inactive ? "Your account is not active" : "Your account is waiting for approval by your Branch Manager"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {inactive
              ? "Please contact your Branch Manager if you think this is a mistake."
              : "We'll let you in as soon as your account has been approved. Thank you for your patience."}
          </p>
          <Button variant="outline" className="mt-6 h-12 rounded-xl" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  const items = NAV_ITEMS.filter((i) => !i.managerOnly || isManager);
  const primary = items.filter((i) => MOBILE_PRIMARY.includes(i.to));
  const more = items.filter((i) => !MOBILE_PRIMARY.includes(i.to));
  const active = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar p-5 text-sidebar-foreground lg:flex">
        <Logo className="mb-8 px-2" />
        <nav aria-label="Main" className="flex-1 space-y-1">
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-primary"
            >
              <Icon className="h-5 w-5" aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        <button onClick={signOut} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-sidebar-accent">
          <LogOut className="h-5 w-5" aria-hidden /> Sign out
        </button>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Logo className="text-primary" />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-10">
        <Outlet />
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {primary.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground data-[status=active]:text-primary">
            <Icon className="h-6 w-6" aria-hidden /> {label}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${more.some((m) => active(m.to)) ? "text-primary" : "text-muted-foreground"}`}
        >
          <MoreHorizontal className="h-6 w-6" aria-hidden /> More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>More</SheetTitle></SheetHeader>
          <div className="grid gap-1 p-4 pt-0">
            {more.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted data-[status=active]:bg-secondary data-[status=active]:text-primary">
                <Icon className="h-5 w-5" aria-hidden /> {label}
              </Link>
            ))}
            <button onClick={signOut} className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted">
              <LogOut className="h-5 w-5" aria-hidden /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
