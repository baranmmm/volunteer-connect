import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { checkNoticeLink, unsubscribeNoticeEmails } from "@/lib/notice-emails.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

type State = "checking" | "valid" | "unsubscribed" | "invalid";

/**
 * "Stop these emails" from a member notice email: shows which kind of email it stops and turns it off with a click
 * (mail scanners open links; the click is a POST). In the app the notices stay as set in Profile > Notifications.
 */
export function NoticeEmailLinkPage({ token }: { token: string | undefined }) {
  const { t } = useTranslation();
  const check = useServerFn(checkNoticeLink);
  const stop = useServerFn(unsubscribeNoticeEmails);
  const [state, setState] = useState<State>(token ? "checking" : "invalid");
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let live = true;
    check({ data: { token } })
      .then((r) => {
        if (!live) return;
        setState(r.state === "valid" ? "valid" : "invalid");
        setType(r.state === "valid" ? r.type : null);
      })
      .catch(() => live && setState("invalid"));
    return () => {
      live = false;
    };
  }, [token, check]);

  const act = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const r = await stop({ data: { token } });
      setState(r.state === "unsubscribed" ? "unsubscribed" : "invalid");
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  const label = type ? t(`notifications.settings.types.${type}`) : "";
  return (
    <div data-testid="notice-email-link-page" className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">{t("noticeEmails.title")}</h1>
      {state === "checking" ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : state === "valid" ? (
        <div className="space-y-3">
          <p>{t("noticeEmails.intro", { label })}</p>
          <p className="text-sm text-muted-foreground">{t("noticeEmails.inApp")}</p>
          {error && (
            <p
              role="alert"
              data-testid="notice-email-link-error"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            data-testid="notice-email-unsubscribe-button"
            className="h-11"
            disabled={busy}
            onClick={() => void act()}
          >
            {t("noticeEmails.button")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p data-testid="notice-email-link-state" data-state={state} aria-live="polite">
            {state === "unsubscribed"
              ? t("noticeEmails.done", { label })
              : t("noticeEmails.invalid")}
          </p>
        </div>
      )}
      <Link
        to="/profile"
        data-testid="notice-email-settings-link"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        {t("noticeEmails.settings")}
      </Link>
    </div>
  );
}
