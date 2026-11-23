import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HandHeart, HeartHandshake, Network } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useNcDashboard } from "@/lib/national";
import { useMyApplications } from "@/lib/volunteer-applications";
import { DONATE_URL } from "@/lib/config";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  ApplicationStatusBadge,
  VolunteerApplicationForm,
} from "@/components/requests/VolunteerApplications";

/** National Coordinator overview: numbers only for volunteers and followers. */
export function NcDashboard() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const stats = useNcDashboard(session?.user.id, true);
  const keys = [
    "regions",
    "branches",
    "volunteers",
    "followers",
    "upcoming_events",
    "registrations_30d",
    "attended_30d",
    "pending_requests",
    "open_applications",
  ] as const;
  return (
    <section
      data-testid="nc-dashboard"
      aria-labelledby="nc-dashboard-h"
      className="space-y-4 lg:col-span-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="nc-dashboard-h" className="text-xl font-semibold">
          {t("nc.overview")}
        </h2>
        <Button asChild variant="outline">
          <Link to="/regions" data-testid="nc-dashboard-regions">
            <Network />
            {t("navigation.regions")}
          </Link>
        </Button>
      </div>
      {stats.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : stats.isError ? (
        <p role="alert" className="text-destructive">
          {translateError(stats.error)}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {keys.map((key) => (
            <div
              key={key}
              data-testid={`nc-stat-${key}`}
              data-value={stats.data?.[key]}
              className="rounded-2xl border bg-card p-4"
            >
              <dt className="text-sm text-muted-foreground">{t(`nc.stats.${key}`)}</dt>
              <dd className="mt-1 text-3xl font-bold">{stats.data?.[key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Followers: "Become a volunteer" (or the open application's status) and Donate. */
export function FollowerCards() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const applications = useMyApplications(session?.user.id);
  const open = applications.data?.find((a) => a.status === "submitted");
  const [applying, setApplying] = useState(false);
  return (
    <>
      <section
        data-testid="follower-become-volunteer"
        aria-labelledby="become-volunteer-h"
        className="space-y-3 rounded-3xl border bg-card p-6 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <HandHeart className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="become-volunteer-h" className="text-xl font-semibold">
            {t("applications.becomeVolunteer")}
          </h2>
        </div>
        {open ? (
          <div className="space-y-2">
            <p className="text-sm">{t("applications.openFor", { branch: open.branch })}</p>
            <ApplicationStatusBadge status={open.status} />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("applications.becomeVolunteerText")}</p>
            <Button data-testid="follower-apply" className="h-11" onClick={() => setApplying(true)}>
              {t("applications.apply")}
            </Button>
          </>
        )}
      </section>
      <section
        aria-labelledby="donate-h"
        className="space-y-3 rounded-3xl border bg-card p-6 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <HeartHandshake className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="donate-h" className="text-xl font-semibold">
            {t("donate.title")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("donate.text")}</p>
        <Button asChild className="h-11">
          <a
            data-testid="follower-dashboard-donate"
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("donate.button")}
            <span className="sr-only"> {t("common.opensInNewTab")}</span>
          </a>
        </Button>
      </section>
      {applying && (
        <VolunteerApplicationForm
          onClose={() => setApplying(false)}
          onSaved={() => setApplying(false)}
        />
      )}
    </>
  );
}
