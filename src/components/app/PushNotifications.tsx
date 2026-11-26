// Web Push UI (signed-in pages only): the "this device" switch and the other devices in Profile > Notifications, and the
// dashboard card in the installed app. Nothing asks for permission on page load: only the switch and the card's button
// do, from the click itself.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { APP_SHORT_NAME } from "@/lib/push/config";
import {
  disablePush,
  enablePush,
  listPushDevices,
  pushEnvironment,
  removePushDevice,
  usePushState,
} from "@/lib/push/client";
import {
  pushPromptMode,
  pushSettingsHelp,
  readPushPromptMemory,
  recordPushPromptDismissal,
  type PushPromptMemory,
  type PushSettingsHelp,
} from "@/lib/push/support";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const HELP_STEPS: Record<PushSettingsHelp, string[]> = {
  ios: ["step1", "step2", "step3"],
  android: ["step1", "step2", "step3"],
  desktop: ["step1", "step2"],
};

/** How to allow notifications again, for this platform. */
function SettingsHelp({ testId }: { testId: string }) {
  const { t } = useTranslation();
  const env = pushEnvironment();
  const help = pushSettingsHelp(env);
  return (
    <ol data-testid={testId} data-platform={help} className="list-decimal space-y-1 pl-5 text-sm">
      {HELP_STEPS[help].map((step) => (
        <li key={step}>{t(`push.help.${help}.${step}`, { app: APP_SHORT_NAME })}</li>
      ))}
    </ol>
  );
}

function useEnable() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return () =>
    // Straight from the click: enablePush() asks for permission before anything else.
    void enablePush().then((result) => {
      if (result === "on") {
        toast.success(t("push.device.enabled"));
        void qc.invalidateQueries({ queryKey: ["push-devices"] });
      } else if (result === "failed") toast.error(t("push.device.failed"));
    });
}

/**
 * Profile > Notifications, top: one On/Off switch for push on this device (on = ask for permission from the click and
 * register this device; off = unregister it). Where push cannot work here it shows a short note instead of the switch.
 */
export function PushSwitch() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const push = usePushState();
  const enable = useEnable();
  const state = push.device;

  async function disable() {
    if (await disablePush()) {
      toast.success(t("push.device.disabled"));
      void qc.invalidateQueries({ queryKey: ["push-devices"] });
    } else toast.error(t("push.device.disableFailed"));
  }

  const switchable = state === null || state === "off" || state === "on";
  return (
    <div data-testid="profile-push" data-state={state ?? "loading"} className="space-y-1">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor="profile-push-switch" className="text-base font-medium leading-snug">
          {t("push.device.title")}
        </Label>
        {switchable && (
          <Switch
            id="profile-push-switch"
            data-testid="profile-push-switch"
            checked={state === "on"}
            disabled={state === null || push.busy}
            aria-describedby="profile-push-hint"
            // Straight from the click: enablePush() asks for permission first.
            onCheckedChange={(on) => (on ? enable() : void disable())}
          />
        )}
      </div>
      <p id="profile-push-hint" className="text-sm text-muted-foreground">
        {t("push.device.intro")}
      </p>
      {state === "unsupported" ? (
        <p data-testid="profile-push-unsupported" className="text-sm">
          {t("push.device.unsupported")}
        </p>
      ) : state === "ios-install" ? (
        <p data-testid="profile-push-ios-install" className="text-sm">
          {t("push.device.iosInstall")}
        </p>
      ) : state === "denied" ? (
        <div data-testid="profile-push-denied" className="space-y-1">
          <p className="text-sm">{t("push.device.denied")}</p>
          <SettingsHelp testId="profile-push-denied-help" />
        </div>
      ) : null}
    </div>
  );
}

/** Profile > Notifications > Advanced: my other devices with push on (Remove). Nothing when there are none. */
export function PushOtherDevices() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const push = usePushState();
  const devices = useQuery({
    queryKey: ["push-devices", push.endpoint],
    queryFn: () => listPushDevices(),
    enabled: push.device !== null && push.device !== "unsupported",
    staleTime: 60000,
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const others = (devices.data ?? []).filter((d) => !d.current);

  async function remove(id: string) {
    setRemoving(id);
    try {
      await removePushDevice(id);
      toast.success(t("push.device.removed"));
      await qc.invalidateQueries({ queryKey: ["push-devices"] });
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setRemoving(null);
    }
  }

  if (others.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{t("push.device.otherDevices")}</p>
      <ul className="divide-y">
        {others.map((d) => {
          const label = d.user_agent ?? t("push.device.unknownDevice");
          return (
            <li
              key={d.id}
              data-testid="profile-push-device"
              data-device-id={d.id}
              className="flex min-h-11 items-center justify-between gap-3 py-1 text-sm"
            >
              <span className="[overflow-wrap:anywhere]">{label}</span>
              <Button
                data-testid="profile-push-device-remove"
                variant="ghost"
                className="h-11 rounded-xl"
                disabled={removing !== null}
                aria-label={t("push.device.removeLabel", { label })}
                onClick={() => void remove(d.id)}
              >
                {t("push.device.remove")}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Dashboard card, installed app only: "Turn on notifications" while push is off on this device; after a refusal, how
 * to allow notifications in the phone's settings. "Not now" hides it; it returns once after 7 days, and after a second
 * "Not now" never again (Profile > Notifications stays). The install banner never shows at the same time: it is only
 * offered outside the installed app, and this card only inside it.
 */
export function PushPromptCard() {
  const { t } = useTranslation();
  const push = usePushState();
  const enable = useEnable();
  const [memory, setMemory] = useState<PushPromptMemory>(() => readPushPromptMemory(storage()));
  const mode = pushPromptMode({
    standalone: pushEnvironment().standalone,
    state: push.device,
    memory,
    now: Date.now(),
  });
  if (!mode) return null;
  const notNow = () => setMemory(recordPushPromptDismissal(storage(), memory, Date.now()));
  return (
    <section
      data-testid="push-prompt"
      data-mode={mode}
      aria-labelledby="push-prompt-title"
      className="space-y-3 rounded-2xl border border-primary/40 bg-card p-4 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="push-prompt-title" className="font-semibold">
            {t(mode === "ask" ? "push.card.title" : "push.card.deniedTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(mode === "ask" ? "push.card.text" : "push.card.deniedText")}
          </p>
          {mode === "denied" && <SettingsHelp testId="push-prompt-help" />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          data-testid="push-prompt-not-now"
          variant="ghost"
          className="h-11 rounded-xl"
          onClick={notNow}
        >
          {t("push.card.notNow")}
        </Button>
        {mode === "ask" && (
          <Button
            data-testid="push-prompt-enable"
            className="h-11 rounded-xl"
            disabled={push.busy}
            onClick={enable}
          >
            {t("push.card.button")}
          </Button>
        )}
      </div>
    </section>
  );
}
