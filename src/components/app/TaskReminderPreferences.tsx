import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/** Profile > Notifications: email reminders for tasks (in-app reminders follow the Task reminders setting). */
export function TaskReminderEmails({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-11 items-start gap-3">
      <Switch
        id="profile-task-reminder-emails"
        data-testid="profile-task-reminder-emails"
        checked={on}
        disabled={disabled}
        aria-describedby="profile-task-reminder-emails-hint"
        onCheckedChange={onChange}
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
  );
}
