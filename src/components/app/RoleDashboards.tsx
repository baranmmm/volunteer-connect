import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Clock, HandHeart, HeartHandshake, Network } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useNcDashboard, useRegionsTree } from "@/lib/national";
import { useMyApplications } from "@/lib/volunteer-applications";
import { useFollowedBranches } from "@/lib/followed-branches";
import { branchList } from "@/lib/notification-text";
import { DONATE_URL } from "@/lib/config";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { VolunteerApplicationForm } from "@/components/requests/VolunteerApplications";
import { BranchMapCard } from "@/components/regions/BranchMapCard";

/** National Coordinator overview: numbers only for volunteers, trustees and followers. */
export function NcDashboard() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const raw = useNcDashboard(session?.user.id, true);
  // Volunteers = users with the volunteer role only, the same totals as "Volunteers by branch".
  const tree = useRegionsTree(session?.user.id, true);
  const volunteers = tree.data?.reduce(
    (sum, r) => sum + r.branches.reduce((s, b) => s + b.volunteers, 0),
    0,
  );
  const stats = {
    ...raw,
    data: raw.data && { ...raw.data, volunteers: volunteers ?? raw.data.volunteers },
  };
  const keys = [
    "regions",
    "branches",
    "volunteers",
    "trustees",
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
      <BranchMapCard />
    </section>
  );
}

/** Followers: Donate (the volunteer application lives in the status strip above). */
export function FollowerCards() {
  const { t } = useTranslation();
  return (
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
  );
}

/**
 * Followers: a slim status line. Following → "Become a Dialogue Society volunteer"; an open application → waiting
 * for approval; the latest application declined → the manager's note and the button again. Followers have no
 * notification bell, so the decline is shown here.
 */
export function FollowerStrip() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const applications = useMyApplications(session?.user.id);
  const followed = useFollowedBranches(session?.user.id);
  const [applying, setApplying] = useState(false);
  if (applications.isLoading || followed.isLoading) return null;
  const latest = applications.data?.[0];
  const open = applications.data?.find((a) => a.status === "submitted");
  const declined = !open && latest?.status === "declined" ? latest : null;
  const names = followed.data?.length ? branchList(followed.data.map((b) => b.name)) : "";
  const applyButton = (
    <Button
      data-testid="dashboard-follower-strip-apply"
      className="h-11 shrink-0"
      onClick={() => setApplying(true)}
    >
      <HandHeart aria-hidden />
      {t("applications.becomeVolunteer")}
    </Button>
  );
  return (
    <section
      data-testid="dashboard-follower-strip"
      aria-label={t("applications.stripLabel")}
      className="flex flex-col gap-3 rounded-2xl border bg-card px-4 py-3 shadow-soft sm:flex-row sm:items-center sm:justify-between"
    >
      {open ? (
        <p
          data-testid="dashboard-follower-strip-pending"
          className="flex items-center gap-2 text-sm [overflow-wrap:anywhere]"
        >
          <Clock className="size-4 shrink-0 text-primary" aria-hidden />
          {t("applications.stripPending")}
        </p>
      ) : declined ? (
        <>
          <div data-testid="dashboard-follower-strip-declined" className="space-y-1 text-sm">
            <p className="font-medium [overflow-wrap:anywhere]">
              {t("applications.stripDeclined", { branch: declined.branch })}
            </p>
            {declined.decline_reason && (
              <p
                data-testid="dashboard-follower-strip-decline-reason"
                className="text-muted-foreground [overflow-wrap:anywhere]"
              >
                {t("applications.declineReason", { reason: declined.decline_reason })}
              </p>
            )}
          </div>
          {applyButton}
        </>
      ) : (
        <>
          <p
            data-testid="dashboard-follower-strip-following"
            className="text-sm [overflow-wrap:anywhere]"
          >
            {t("applications.stripFollowing", { branch: names })}
          </p>
          {applyButton}
        </>
      )}
      {applying && (
        <VolunteerApplicationForm
          onClose={() => setApplying(false)}
          onSaved={() => setApplying(false)}
        />
      )}
    </section>
  );
}

/**
 * Shown once after sign-up / the first sign-in of a follower (profiles.welcome_seen_at is empty): what following
 * means, or that the volunteer application went to the branch's managers. "Go to dashboard" records it as seen.
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const { session, refresh } = useAuth();
  const applications = useMyApplications(session?.user.id);
  const followed = useFollowedBranches(session?.user.id);
  const [busy, setBusy] = useState(false);
  if (applications.isLoading || followed.isLoading) return null;
  const open = applications.data?.find((a) => a.status === "submitted");
  const branch = open?.branch ?? followed.data?.[0]?.name ?? "";
  async function done() {
    setBusy(true);
    const { error } = await supabase.rpc("mark_welcome_seen");
    if (error) {
      setBusy(false);
      toast.error(translateError(error));
      return;
    }
    await refresh();
  }
  return (
    <section
      data-testid="welcome-screen"
      data-variant={open ? "applied" : "follower"}
      aria-labelledby="welcome-screen-h"
      className="space-y-4 rounded-3xl bg-hero p-7 text-primary-foreground shadow-soft sm:p-10"
    >
      <h1 id="welcome-screen-h" className="text-3xl font-bold sm:text-4xl">
        {t("welcome.title")}
      </h1>
      <p data-testid="welcome-screen-text" className="max-w-2xl text-lg [overflow-wrap:anywhere]">
        {t(open ? "welcome.applied" : "welcome.follower", { branch })}
      </p>
      <Button
        data-testid="welcome-continue"
        variant="secondary"
        className="h-11"
        disabled={busy}
        onClick={() => void done()}
      >
        {t("welcome.continue")}
      </Button>
    </section>
  );
}
