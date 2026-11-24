import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { confirmSubscriber, unsubscribe, type SubscriberState } from "@/lib/public-guest.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * "Get event updates" email links: confirm the subscription (double opt-in) or unsubscribe. Both need a click (mail
 * scanners open links); the click is a POST.
 */
export function SubscriberLinkPage({
  mode,
  token,
}: {
  mode: "confirm" | "unsubscribe";
  token: string | undefined;
}) {
  const { t } = useTranslation();
  const confirm = useServerFn(confirmSubscriber);
  const leave = useServerFn(unsubscribe);
  const [state, setState] = useState<SubscriberState | null>(token ? null : "invalid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      setState((await (mode === "confirm" ? confirm : leave)({ data: { token } })).state);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="subscriber-link-page" className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">
        {t(mode === "confirm" ? "subscribe.confirmTitle" : "subscribe.unsubscribeTitle")}
      </h1>
      {state ? (
        <div className="space-y-3">
          <p data-testid="subscriber-link-state" data-state={state} aria-live="polite">
            {t(`subscribe.state.${state}`)}
          </p>
          <Link
            to="/events"
            className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
          >
            {t("subscribe.seeEvents")}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            {t(mode === "confirm" ? "subscribe.confirmIntro" : "subscribe.unsubscribeIntro")}
          </p>
          {error && (
            <p
              role="alert"
              data-testid="subscriber-link-error"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            data-testid={
              mode === "confirm" ? "subscriber-confirm-button" : "subscriber-unsubscribe-button"
            }
            variant={mode === "confirm" ? "default" : "outline"}
            className="h-11"
            disabled={busy}
            onClick={() => void act()}
          >
            {t(mode === "confirm" ? "subscribe.confirmButton" : "subscribe.unsubscribeButton")}
          </Button>
        </div>
      )}
    </div>
  );
}
