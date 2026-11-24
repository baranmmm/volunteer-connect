import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type {
  NotificationDelivery,
  NotificationSetting,
  NotificationSettings as Settings,
} from "@/lib/notifications";
import {
  getNotificationSettings,
  setNotificationSetting,
  setTaskReminderEmails,
} from "@/lib/notifications.functions";
import { useWorkMember } from "@/lib/use-work-notices";
import { TaskReminderEmails } from "@/components/app/TaskReminderPreferences";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type ChangeableType = "task_status" | "task_note" | "task_reminder" | "meeting" | "request_decided";

/**
 * Profile > Notifications (volunteers and up): per type on/off and Immediately / Daily summary. Assignments, mentions
 * and requests waiting for review are always on and immediate (shown with disabled controls). The database checks
 * every change (set_notification_setting).
 */
export function NotificationSettings() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const qc = useQueryClient();
  const fetch = useServerFn(getNotificationSettings),
    save = useServerFn(setNotificationSetting),
    saveEmails = useServerFn(setTaskReminderEmails);
  const key = ["notification-settings", session?.user.id];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 300000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function change(setting: NotificationSetting, next: Partial<NotificationSetting>) {
    if (setting.locked) return;
    const updated = { ...setting, ...next };
    setBusy(setting.type);
    try {
      await save({
        data: {
          type: setting.type as ChangeableType,
          enabled: updated.enabled,
          delivery: updated.delivery,
        },
      });
      qc.setQueryData<Settings>(key, (old) =>
        old
          ? { ...old, types: old.types.map((s) => (s.type === setting.type ? updated : s)) }
          : old,
      );
      toast.success(t("notifications.settings.saved"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(null);
    }
  }
  async function changeEmails(on: boolean) {
    setBusy("emails");
    try {
      await saveEmails({ data: { on } });
      qc.setQueryData<Settings>(key, (old) => (old ? { ...old, task_reminder_emails: on } : old));
      toast.success(t("notifications.preferences.saved"));
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
      data-testid="profile-notifications"
      aria-labelledby="profile-notifications-h"
      className="max-w-xl space-y-4 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <div className="space-y-1">
        <h2 id="profile-notifications-h" className="text-xl font-semibold">
          {t("notifications.settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("notifications.settings.intro")}{" "}
          {data &&
            t(
              data.default_delivery === "digest"
                ? "notifications.settings.defaultDigest"
                : "notifications.settings.defaultImmediate",
            )}
        </p>
      </div>
      {settings.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : settings.isError || !data ? (
        <p role="alert" className="text-sm text-destructive">
          {t("notifications.settings.loadError")}
        </p>
      ) : (
        <>
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
          <TaskReminderEmails
            on={data.task_reminder_emails}
            disabled={busy !== null}
            onChange={(on) => void changeEmails(on)}
          />
        </>
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
  onChange: (next: Partial<NotificationSetting>) => void;
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
      data-delivery={s.delivery}
      className="space-y-2 py-3"
    >
      <div className="flex min-h-11 items-start gap-3">
        <Switch
          id={`${id}-enabled`}
          data-testid="profile-notification-enabled"
          checked={s.enabled}
          disabled={s.locked || busy}
          aria-describedby={s.locked ? `${id}-locked` : undefined}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`${id}-enabled`} className="leading-snug [overflow-wrap:anywhere]">
            {label}
          </Label>
          {s.locked && (
            <p id={`${id}-locked`} className="text-sm text-muted-foreground">
              {t("notifications.settings.locked")}
            </p>
          )}
        </div>
      </div>
      <RadioGroup
        data-testid="profile-notification-delivery"
        aria-label={`${label}: ${t("notifications.settings.delivery")}`}
        value={s.delivery}
        disabled={s.locked || !s.enabled || busy}
        onValueChange={(v) => onChange({ delivery: v as NotificationDelivery })}
        className="ml-12 flex flex-wrap gap-x-5 gap-y-2"
      >
        {(["immediate", "digest"] as const).map((d) => (
          <div key={d} className="flex min-h-11 items-center gap-2">
            <RadioGroupItem
              id={`${id}-${d}`}
              value={d}
              data-testid={`profile-notification-delivery-${d}`}
            />
            <Label htmlFor={`${id}-${d}`} className="font-normal">
              {t(`notifications.settings.${d}`)}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </li>
  );
}
