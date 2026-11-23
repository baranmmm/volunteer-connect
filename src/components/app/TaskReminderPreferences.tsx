import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { getNotificationPreferences, setTaskReminderEmails } from "@/lib/notifications.functions";
import { useWorkMember } from "@/lib/use-work-notices";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/** Profile (volunteers and up): email reminders for tasks. In-app reminders always appear. */
export function TaskReminderPreferences() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const qc = useQueryClient();
  const fetch = useServerFn(getNotificationPreferences),
    save = useServerFn(setTaskReminderEmails);
  const key = ["notification-preferences", session?.user.id];
  const prefs = useQuery({
    queryKey: key,
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 300000,
  });
  const [busy, setBusy] = useState(false);
  async function change(on: boolean) {
    setBusy(true);
    try {
      qc.setQueryData(key, await save({ data: { on } }));
      toast.success(t("notifications.preferences.saved"));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  if (!member) return null;
  const on = !!prefs.data?.task_reminder_emails;
  return (
    <section
      aria-labelledby="task-reminders-h"
      className="max-w-xl space-y-4 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <h2 id="task-reminders-h" className="text-xl font-semibold">
        {t("notifications.preferences.title")}
      </h2>
      <div className="flex min-h-11 items-start gap-3">
        <Switch
          id="profile-task-reminder-emails"
          data-testid="profile-task-reminder-emails"
          checked={on}
          disabled={!prefs.data || busy}
          aria-describedby="profile-task-reminder-emails-hint"
          onCheckedChange={(v) => void change(v)}
        />
        <div className="space-y-1">
          <Label htmlFor="profile-task-reminder-emails" className="leading-snug">
            {t("notifications.preferences.taskEmails")}
          </Label>
          <p id="profile-task-reminder-emails-hint" className="text-sm text-muted-foreground">
            {t(
              on
                ? "notifications.preferences.taskEmailsOn"
                : "notifications.preferences.taskEmailsOff",
            )}
          </p>
        </div>
      </div>
      {prefs.isError && (
        <p role="alert" className="text-sm text-destructive">
          {translateError(prefs.error)}
        </p>
      )}
    </section>
  );
}
