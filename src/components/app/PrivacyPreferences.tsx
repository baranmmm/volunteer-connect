import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { getPrivacyStatus, setConsentPreferences } from "@/lib/privacy.functions";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/** Profile: the confirmed notice version and date, and the two optional consents (off by default). */
export function PrivacyPreferences() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const qc = useQueryClient();
  const fetch = useServerFn(getPrivacyStatus),
    save = useServerFn(setConsentPreferences);
  const status = useQuery({
    queryKey: ["privacy-status", session?.user.id],
    queryFn: () => fetch(),
    staleTime: 300000,
  });
  const [busy, setBusy] = useState(false);
  async function change(next: { photo: boolean; updates: boolean }) {
    setBusy(true);
    try {
      const updated = await save({ data: next });
      qc.setQueryData(["privacy-status", session?.user.id], updated);
      toast.success(t("privacy.preferencesSaved"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const s = status.data;
  return (
    <section
      aria-labelledby="privacy-h"
      className="max-w-xl space-y-4 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <h2 id="privacy-h" className="text-xl font-semibold">
        {t("privacy.profileTitle")}
      </h2>
      <p className="text-sm">
        <Link to="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("privacy.readNotice")}
        </Link>
      </p>
      {s && (
        <p
          data-testid="profile-privacy-version"
          data-version={s.accepted_version ?? ""}
          className="text-sm text-muted-foreground"
        >
          {s.accepted_version && s.accepted_at
            ? t("privacy.confirmedOn", {
                version: s.accepted_version,
                date: formatDate(s.accepted_at, { dateStyle: "medium" }),
              })
            : t("privacy.notConfirmed")}
        </p>
      )}
      {(["photo", "updates"] as const).map((key) => {
        const id = key === "photo" ? "profile-photo-consent" : "profile-updates-consent";
        const checked = key === "photo" ? !!s?.photo_consent : !!s?.updates_email_consent;
        return (
          <div key={key} className="flex min-h-11 items-start gap-3">
            <Switch
              id={id}
              data-testid={id}
              checked={checked}
              disabled={!s || busy}
              onCheckedChange={(v) =>
                s &&
                void change({
                  photo: key === "photo" ? v : s.photo_consent,
                  updates: key === "updates" ? v : s.updates_email_consent,
                })
              }
            />
            <Label htmlFor={id} className="leading-snug">
              {t(key === "photo" ? "privacy.photoConsent" : "privacy.updatesConsent")}
            </Label>
          </div>
        );
      })}
    </section>
  );
}
