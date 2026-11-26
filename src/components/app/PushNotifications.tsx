// Web Push UI (signed-in pages only): the "this device" panel in Profile > Notifications and the dashboard card in the
// installed app. Nothing asks for permission on page load: only the buttons here do, from the click itself.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BellRing, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** Profile > Notifications: push on this device (state, enable / disable), and my other devices. */
export function PushDevicePanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const push = usePushState();
  const enable = useEnable();
  const devices = useQuery({
    queryKey: ["push-devices", push.endpoint],
    queryFn: () => listPushDevices(),
    enabled: push.device !== null && push.device !== "unsupported",
    staleTime: 60000,
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const others = (devices.data ?? []).filter((d) => !d.current);

  async function disable() {
    if (await disablePush()) {
      toast.success(t("push.device.disabled"));
      void qc.invalidateQueries({ queryKey: ["push-devices"] });
    } else toast.error(t("push.device.disableFailed"));
  }
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

  return (
    <div
      data-testid="profile-push"
      data-state={push.device ?? "loading"}
      className="space-y-3 rounded-xl border bg-muted/30 p-4"
    >
      <div className="space-y-1">
        <h3 className="font-semibold">{t("push.device.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("push.device.intro")}</p>
      </div>
      {push.device === null ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : push.device === "unsupported" ? (
        <p data-testid="profile-push-unsupported" className="text-sm">
          {t("push.device.unsupported")}
        </p>
      ) : push.device === "ios-install" ? (
        <p data-testid="profile-push-ios-install" className="text-sm">
          {t("push.device.iosInstall")}
        </p>
      ) : push.device === "denied" ? (
        <div data-testid="profile-push-denied" className="space-y-2">
          <p className="text-sm">{t("push.device.denied")}</p>
          <SettingsHelp testId="profile-push-denied-help" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p data-testid="profile-push-status" className="text-sm">
            {t(push.device === "on" ? "push.device.on" : "push.device.off")}
          </p>
          {push.device === "on" ? (
            <Button
              data-testid="profile-push-disable"
              variant="outline"
              className="h-11 rounded-xl"
              disabled={push.busy}
              onClick={() => void disable()}
            >
              <BellOff className="mr-2 h-4 w-4" aria-hidden />
              {t("push.device.disable")}
            </Button>
          ) : (
            <Button
              data-testid="profile-push-enable"
              className="h-11 rounded-xl"
              disabled={push.busy}
              onClick={enable}
            >
              <BellRing className="mr-2 h-4 w-4" aria-hidden />
              {t("push.device.enable")}
            </Button>
          )}
        </div>
      )}
      {others.length > 0 && (
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
      )}
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
