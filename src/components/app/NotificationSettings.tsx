import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type {
  NotificationSetting,
  NotificationSettings as Settings,
  NotificationType,
} from "@/lib/notifications";
import {
  getNotificationSettings,
  setNotificationEmail,
  setNotificationSetting,
} from "@/lib/notifications.functions";
import { setNotificationPush } from "@/lib/push.functions";
import {
  EMAIL_MODES,
  emailModeChanges,
  emailModeOf,
  withEmailMode,
  withTypeChange,
  type EmailMode,
} from "@/lib/notification-email-mode";
import { PushOtherDevices, PushSwitch } from "@/components/app/PushNotifications";
import { useWorkMember } from "@/lib/use-work-notices";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ChangeableType = "task_status" | "task_note" | "task_reminder" | "meeting" | "request_decided";
type Change = { enabled?: boolean; email?: boolean; push?: boolean };

/**
 * Profile > Notifications (volunteers and up), short by default: one push switch for this device, one Email choice
 * (all / important only / none, a shortcut over the per-type email switches; "custom" when they match none), and a line
 * saying in-app notices are always on. "Advanced settings" (collapsed) holds the per-type table: In the app (locked
 * types: disabled and checked), Email (disabled while the type is off in the app), Push (this member's per-type push
 * switch, independent of this device), and the member's other push devices. Every change is optimistic and rolled back
 * on an error; the database checks each one (set_notification_setting, set_notification_email, set_notification_push).
 */
export function NotificationSettings() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const qc = useQueryClient();
  const fetch = useServerFn(getNotificationSettings),
    saveInApp = useServerFn(setNotificationSetting),
    saveEmail = useServerFn(setNotificationEmail),
    savePush = useServerFn(setNotificationPush);
  const key = ["notification-settings", session?.user.id];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 300000,
  });
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  /** Shows `next` at once, runs the calls together; on an error restores the previous settings and re-reads them. */
  async function save(next: Settings, calls: (() => Promise<unknown>)[]) {
    if (calls.length === 0) return;
    setBusy(true);
    // A read still in flight (e.g. the re-read after a failed save) would land after this change and overwrite it.
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<Settings>(key);
    qc.setQueryData<Settings>(key, next);
    try {
      await Promise.all(calls.map((call) => call()));
      toast.success(t("notifications.settings.saved"));
    } catch (e) {
      qc.setQueryData<Settings>(key, previous);
      toast.error(translateError(e));
      // Some calls may have been saved: re-read before the controls work again, so the next change starts from the
      // stored values.
      await qc.invalidateQueries({ queryKey: key }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function changeType(data: Settings, s: NotificationSetting, next: Change) {
    if (next.enabled !== undefined && s.locked) return;
    const type = s.type;
    const call =
      next.enabled !== undefined
        ? () => saveInApp({ data: { type: type as ChangeableType, enabled: next.enabled! } })
        : next.email !== undefined
          ? () => saveEmail({ data: { type, on: next.email! } })
          : () => savePush({ data: { type, on: next.push! } });
    void save(withTypeChange(data, type, next), [call]);
  }

  function chooseMode(data: Settings, mode: EmailMode) {
    const calls = emailModeChanges(data.types, mode).map(
      (c) => () => saveEmail({ data: { type: c.type, on: c.on } }),
    );
    void save(withEmailMode(data, mode), calls);
  }

  if (!member) return null;
  const data = settings.data;
  const mode = data ? emailModeOf(data.types) : null;
  return (
    <section
      id="notifications"
      data-testid="profile-notifications"
      aria-labelledby="profile-notifications-h"
      className="max-w-xl space-y-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="profile-notifications-h" className="text-xl font-semibold">
          {t("notifications.settings.title")}
        </h2>
        <p data-testid="profile-notifications-inapp-note" className="text-sm text-muted-foreground">
          {t("notifications.settings.inAppAlways")}
        </p>
      </div>
      <PushSwitch />
      {settings.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : settings.isError || !data ? (
        <p role="alert" className="text-sm text-destructive">
          {t("notifications.settings.loadError")}
        </p>
      ) : (
        <>
          <div role="group" aria-labelledby="profile-email-mode-h" className="space-y-1">
            <p id="profile-email-mode-h" className="text-base font-medium">
              {t("notifications.settings.email")}
            </p>
            <RadioGroup
              data-testid="profile-email-mode"
              data-mode={mode ?? "custom"}
              aria-labelledby="profile-email-mode-h"
              // "custom" matches no option, so none is checked.
              value={mode ?? "custom"}
              disabled={busy}
              onValueChange={(value) => chooseMode(data, value as EmailMode)}
              className="gap-0"
            >
              {EMAIL_MODES.map((m) => (
                <div key={m} className="flex min-h-11 items-center gap-3">
                  <RadioGroupItem
                    id={`profile-email-mode-${m}`}
                    data-testid={`profile-email-mode-${m}`}
                    value={m}
                    className="h-5 w-5"
                  />
                  <Label htmlFor={`profile-email-mode-${m}`} className="font-normal leading-snug">
                    {t(`notifications.settings.emailModes.${m}`)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {mode === "custom" && (
              <p data-testid="profile-email-mode-custom" className="text-sm text-muted-foreground">
                {t("notifications.settings.emailModes.custom")}
              </p>
            )}
          </div>
          <div>
            <button
              type="button"
              data-testid="profile-notifications-advanced-toggle"
              aria-expanded={advanced}
              aria-controls="profile-notifications-advanced"
              onClick={() => setAdvanced((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("notifications.settings.advanced")}
              <ChevronDown
                aria-hidden
                className={cn("h-5 w-5 transition-transform", advanced && "rotate-180")}
              />
            </button>
            {advanced && (
              <div
                id="profile-notifications-advanced"
                data-testid="profile-notifications-advanced"
                className="space-y-4 pt-2"
              >
                <AdvancedTable
                  types={data.types}
                  busy={busy}
                  onChange={(s, next) => changeType(data, s, next)}
                />
                <PushOtherDevices />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const CHANNELS = ["inapp", "email", "push"] as const;
type Channel = (typeof CHANNELS)[number];

function AdvancedTable({
  types,
  busy,
  onChange,
}: {
  types: NotificationSetting[];
  busy: boolean;
  onChange: (s: NotificationSetting, next: Change) => void;
}) {
  const { t } = useTranslation();
  const channel = (c: Channel) => t(`notifications.settings.columns.${c}`);
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">{t("notifications.settings.advanced")}</caption>
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-1 text-left font-medium">
            {t("notifications.settings.columns.type")}
          </th>
          {CHANNELS.map((c) => (
            <th key={c} scope="col" className="w-16 py-1 text-center font-medium">
              {channel(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {types.map((s) => {
          const label = t(`notifications.settings.short.${s.type as NotificationType}`);
          const cell = (c: Channel) => {
            const checked =
              c === "inapp"
                ? s.enabled
                : c === "email"
                  ? s.email && s.enabled
                  : s.push && s.enabled;
            const disabled = busy || (c === "inapp" ? s.locked : !s.enabled);
            const id = `profile-notification-${s.type}-${c}`;
            return (
              <td key={c} className="p-0 text-center">
                <label
                  htmlFor={id}
                  className="flex min-h-11 cursor-pointer items-center justify-center"
                >
                  <Checkbox
                    id={id}
                    data-testid={`profile-notification-${c}`}
                    checked={checked}
                    disabled={disabled}
                    aria-label={t("notifications.settings.cell", { label, channel: channel(c) })}
                    className="h-5 w-5"
                    onCheckedChange={(value) => {
                      const on = value === true;
                      onChange(
                        s,
                        c === "inapp"
                          ? { enabled: on }
                          : c === "email"
                            ? { email: on }
                            : { push: on },
                      );
                    }}
                  />
                </label>
              </td>
            );
          };
          return (
            <tr
              key={s.type}
              data-testid="profile-notification-row"
              data-type={s.type}
              data-locked={s.locked ? "true" : "false"}
              data-enabled={s.enabled ? "true" : "false"}
              data-email={s.email ? "true" : "false"}
              data-push={s.push ? "true" : "false"}
              data-email-timing={s.email_timing}
            >
              <th
                scope="row"
                className="py-1 pr-2 text-left font-normal leading-snug [overflow-wrap:anywhere]"
              >
                {label}
              </th>
              {CHANNELS.map(cell)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
