import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { NotificationSetting, NotificationSettings as Settings } from "@/lib/notifications";
import {
  getNotificationSettings,
  setNotificationEmail,
  setNotificationSetting,
} from "@/lib/notifications.functions";
import { useWorkMember } from "@/lib/use-work-notices";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type ChangeableType = "task_status" | "task_note" | "task_reminder" | "meeting" | "request_decided";

/**
 * Profile > Notifications (volunteers and up): per type "In the app" on/off and "Email" on/off. Every notice that is on
 * appears in the app at once. Email timing is fixed per type (shown under each row): assignments, requests waiting for
 * review, meeting invitations and task reminders at once, everything else in the 08:00 daily summary. Assignments,
 * mentions and requests waiting for review are always on in the app (disabled switch); their email can be turned off.
 * The database checks every change (set_notification_setting, set_notification_email).
 */
export function NotificationSettings() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const qc = useQueryClient();
  const fetch = useServerFn(getNotificationSettings),
    saveInApp = useServerFn(setNotificationSetting),
    saveEmail = useServerFn(setNotificationEmail);
  const key = ["notification-settings", session?.user.id];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 300000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function change(
    setting: NotificationSetting,
    next: { enabled?: boolean; email?: boolean },
  ) {
    if (next.enabled !== undefined && setting.locked) return;
    const updated = { ...setting, ...next };
    setBusy(setting.type);
    try {
      if (next.enabled !== undefined)
        await saveInApp({ data: { type: setting.type as ChangeableType, enabled: next.enabled } });
      else if (next.email !== undefined)
        await saveEmail({ data: { type: setting.type, on: next.email } });
      qc.setQueryData<Settings>(key, (old) =>
        old
          ? {
              ...old,
              task_reminder_emails:
                setting.type === "task_reminder" ? updated.email : old.task_reminder_emails,
              types: old.types.map((s) => (s.type === setting.type ? updated : s)),
            }
          : old,
      );
      toast.success(t("notifications.settings.saved"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!member) return null;
  const data = settings.data;
  return (
    <section
      id="notifications"
      data-testid="profile-notifications"
      aria-labelledby="profile-notifications-h"
      className="max-w-xl space-y-4 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <div className="space-y-1">
        <h2 id="profile-notifications-h" className="text-xl font-semibold">
          {t("notifications.settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("notifications.settings.intro")}</p>
      </div>
      {settings.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : settings.isError || !data ? (
        <p role="alert" className="text-sm text-destructive">
          {t("notifications.settings.loadError")}
        </p>
      ) : (
        <ul className="divide-y">
          {data.types.map((s) => (
            <TypeRow
              key={s.type}
              setting={s}
              busy={busy !== null}
              onChange={(next) => void change(s, next)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TypeRow({
  setting: s,
  busy,
  onChange,
}: {
  setting: NotificationSetting;
  busy: boolean;
  onChange: (next: { enabled?: boolean; email?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const id = `profile-notification-${s.type}`;
  const label = t(`notifications.settings.types.${s.type}`);
  return (
    <li
      data-testid="profile-notification-type"
      data-type={s.type}
      data-locked={s.locked ? "true" : "false"}
      data-enabled={s.enabled ? "true" : "false"}
      data-email={s.email ? "true" : "false"}
      data-email-timing={s.email_timing}
      className="space-y-2 py-3"
    >
      <p id={`${id}-label`} className="font-medium leading-snug [overflow-wrap:anywhere]">
        {label}
      </p>
      {s.locked && (
        <p id={`${id}-locked`} className="text-sm text-muted-foreground">
          {t("notifications.settings.locked")}
        </p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={`${id}-enabled`}
            data-testid="profile-notification-enabled"
            checked={s.enabled}
            disabled={s.locked || busy}
            aria-describedby={s.locked ? `${id}-locked` : undefined}
            aria-label={`${label}: ${t("notifications.settings.inApp")}`}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
          <Label htmlFor={`${id}-enabled`} className="font-normal">
            {t("notifications.settings.inApp")}
          </Label>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={`${id}-email`}
            data-testid="profile-notification-email"
            checked={s.email && s.enabled}
            disabled={!s.enabled || busy}
            aria-describedby={`${id}-timing`}
            aria-label={t("notifications.settings.emailOn", { label })}
            onCheckedChange={(email) => onChange({ email })}
          />
          <Label htmlFor={`${id}-email`} className="font-normal">
            {t("notifications.settings.email")}
          </Label>
        </div>
      </div>
      <p
        id={`${id}-timing`}
        data-testid="profile-notification-email-timing"
        className="text-sm text-muted-foreground"
      >
        {t(`notifications.settings.timing.${s.email_timing}`)}
      </p>
    </li>
  );
}
