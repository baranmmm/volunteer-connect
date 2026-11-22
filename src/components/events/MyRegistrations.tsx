import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Bell, Ticket, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { dismissRegistrationNotice, myRegistrations } from "@/lib/registrations.functions";
import type { MyRegistration } from "@/lib/registrations";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { eventDateText } from "./event-display";
import { RegistrationBadge } from "./RegistrationBadge";

/** Dashboard: notices (promoted / cancelled / removed / changed) and the "My registrations" card. */
export function MyRegistrationsCard() {
  const { t } = useTranslation();
  const { session, profile } = useAuth();
  const fetch = useServerFn(myRegistrations),
    dismiss = useServerFn(dismissRegistrationNotice),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["my-registrations", session?.user.id],
    queryFn: () => fetch(),
    enabled: profile?.status === "active",
    staleTime: 60000,
    refetchInterval: 240000,
  });
  const [error, setError] = useState("");
  const rows = query.data ?? [];
  const notices = rows.filter((r) => r.notice);
  const upcoming = rows.filter(
    (r) =>
      !r.event_removed &&
      r.event_status !== "cancelled" &&
      (r.status === "registered" || r.status === "waitlisted"),
  );
  async function close(r: MyRegistration) {
    setError("");
    try {
      await dismiss({ data: { registrationId: r.registration_id } });
      await qc.invalidateQueries({ queryKey: ["my-registrations"] });
    } catch (e) {
      setError(translateError(e));
    }
  }
  return (
    <>
      {notices.length > 0 && (
        <section aria-label={t("registrations.noticesTitle")} className="space-y-2 lg:col-span-2">
          {notices.map((r) => (
            <div
              key={r.registration_id}
              data-testid={`dashboard-registration-notice-${r.registration_id}`}
              data-notice={r.notice}
              role="status"
              className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
            >
              <Bell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 break-words">
                {t(`registrations.notice.${r.notice}`, { title: r.title })}
                {!r.event_removed && (
                  <>
                    {" "}
                    <Link
                      to="/events/$id"
                      params={{ id: r.event_id }}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t("registrations.viewEvent")}
                    </Link>
                  </>
                )}
              </p>
              <Button
                data-testid={`dashboard-registration-notice-dismiss-${r.registration_id}`}
                variant="ghost"
                size="icon"
                aria-label={t("registrations.dismiss")}
                title={t("registrations.dismiss")}
                onClick={() => void close(r)}
              >
                <X />
              </Button>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      )}
      <section
        data-testid="dashboard-my-registrations"
        aria-labelledby="dashboard-my-registrations-title"
        className="rounded-2xl border bg-card p-6 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <Ticket className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="dashboard-my-registrations-title" className="text-xl font-semibold">
            {t("registrations.myTitle")}
          </h2>
        </div>
        {query.isLoading ? (
          <p className="mt-6 text-muted-foreground">{t("common.loading")}</p>
        ) : query.isError ? (
          <p role="alert" className="mt-6 text-destructive">
            {t("registrations.loadError")}
          </p>
        ) : upcoming.length === 0 ? (
          <p data-testid="dashboard-my-registrations-empty" className="mt-6 text-muted-foreground">
            {t("registrations.myEmpty")}
          </p>
        ) : (
          <ul className="mt-5 space-y-2">
            {upcoming.map((r) => (
              <li key={r.registration_id}>
                <Link
                  to="/events/$id"
                  params={{ id: r.event_id }}
                  data-testid="dashboard-my-registration-item"
                  data-event-id={r.event_id}
                  data-status={r.status}
                  className="block rounded-lg border p-3 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="text-sm text-muted-foreground">{eventDateText(r, t)}</p>
                  <p className="mt-0.5 break-words font-semibold">{r.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <RegistrationBadge status={r.status} />
                    {r.status === "waitlisted" && r.waitlist_position && (
                      <span>
                        {t("registrations.waitlistPosition", { position: r.waitlist_position })}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
