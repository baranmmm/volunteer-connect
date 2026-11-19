import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, ListChecks } from "lucide-react";
import { useAuth, primaryRole } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { pageHead } from "@/components/app/head";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => pageHead("Dashboard", "Your volunteer dashboard."),
  component: Dashboard,
});

function Dashboard() {
  const { profile, roles } = useAuth();
  const { t } = useTranslation();
  const first = profile?.full_name.split(" ")[0];
  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-hero p-7 text-primary-foreground shadow-soft sm:p-10">
        <p className="text-sm font-medium opacity-90">{t("dashboard.welcomeBack")}</p>
        <h1 data-testid="dashboard-welcome" className="mt-1 text-3xl font-semibold sm:text-4xl">{first ? t("dashboard.hello", { name: first }) : t("dashboard.helloNoName")}</h1>
        <p className="mt-3 opacity-90">
          <span data-testid="dashboard-user-role">{t(`common.roles.${primaryRole(roles)}`)}</span>
          {profile?.branches && <> · <span data-testid="dashboard-user-branch">{t("dashboard.branchLine", { branch: profile.branches.name })}</span>{profile.branches.regions && <>, {profile.branches.regions.name}</>}</>}
        </p>
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        <EmptyCard icon={CalendarDays} title={t("dashboard.eventsTitle")} text={t("dashboard.eventsEmpty")} />
        <EmptyCard icon={ListChecks} title={t("dashboard.tasksTitle")} text={t("dashboard.tasksEmpty")} />
      </div>
    </div>
  );
}

function EmptyCard({ icon: Icon, title, text }: { icon: typeof CalendarDays; title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-secondary p-2.5 text-primary"><Icon className="h-5 w-5" aria-hidden /></span>
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <p className="mt-6 text-muted-foreground">{text}</p>
    </div>
  );
}
