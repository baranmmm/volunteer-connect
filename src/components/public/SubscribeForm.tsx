import { useId, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
import { subscribe } from "@/lib/public-guest.functions";
import { getPublicStructure } from "@/lib/public-events.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMAIL_PATTERN,
  Honeypot,
  TurnstileWidget,
  usePublicFormConfig,
  waitForMinFill,
} from "./form-protection";

type Branch = { id: string; name: string };

/**
 * "Get event updates" (double opt-in): email, optional name and branch interest. The answer is always "check your
 * email"; nothing is sent until the confirmation link is opened and confirmed.
 * `branches` may be passed by the page (already loaded); otherwise they are fetched here.
 */
export function SubscribeForm({
  source,
  branches,
  compact = false,
}: {
  source: "landing" | "event_registration";
  branches?: Branch[];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const config = usePublicFormConfig();
  const send = useServerFn(subscribe);
  const fetchStructure = useServerFn(getPublicStructure);
  const structure = useQuery({
    queryKey: ["public-structure"],
    queryFn: () => fetchStructure(),
    enabled: !branches,
    staleTime: 600_000,
  });
  const branchList = branches ?? structure.data?.branches ?? [];
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [branchId, setBranchId] = useState(""),
    [honeypot, setHoneypot] = useState(""),
    [token, setToken] = useState<string | null>(null),
    [resetSignal, setResetSignal] = useState(0),
    [emailError, setEmailError] = useState(""),
    [formError, setFormError] = useState(""),
    [busy, setBusy] = useState(false),
    [sentTo, setSentTo] = useState<string | null>(null);
  const siteKey = config.data?.turnstileSiteKey ?? null;
  const ids = {
    email: `${uid}-email`,
    name: `${uid}-name`,
    branch: `${uid}-branch`,
    consent: `${uid}-consent`,
    error: `${uid}-error`,
  };

  if (sentTo) {
    return (
      <div data-testid="subscribe-form-sent" aria-live="polite" className="space-y-2">
        <p className="flex items-center gap-2 font-semibold">
          <MailCheck className="size-5 text-primary" aria-hidden />
          {t("subscribe.sentTitle")}
        </p>
        <p className="text-sm">{t("subscribe.sentBody", { email: sentTo })}</p>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    const valid = EMAIL_PATTERN.test(email.trim());
    setEmailError(valid ? "" : t("guest.errors.emailInvalid"));
    if (!valid) return;
    if (!config.data) {
      setFormError(t("guest.errors.unavailable"));
      return;
    }
    if (siteKey && !token) {
      setFormError(t("guest.errors.verification"));
      return;
    }
    setBusy(true);
    try {
      await waitForMinFill(config.dataUpdatedAt);
      await send({
        data: {
          email: email.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(branchId ? { branchId } : {}),
          source,
          honeypot,
          startedAt: config.data.formStamp,
          ...(token ? { turnstileToken: token } : {}),
        },
      });
      setSentTo(email.trim());
    } catch (err) {
      setFormError(translateError(err));
    } finally {
      setBusy(false);
      if (siteKey) setResetSignal((n) => n + 1);
    }
  };

  return (
    <form
      data-testid="subscribe-form"
      noValidate
      onSubmit={onSubmit}
      aria-describedby={ids.consent}
      className={`relative ${compact ? "space-y-3" : "space-y-4"}`}
    >
      <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-4"}>
        <div className="space-y-1.5">
          <Label htmlFor={ids.email}>{t("subscribe.email")}</Label>
          <Input
            id={ids.email}
            data-testid="subscribe-form-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? `${ids.email}-error` : undefined}
            className="h-11"
          />
          {emailError && (
            <p
              id={`${ids.email}-error`}
              data-testid="subscribe-form-email-error"
              className="text-sm text-destructive"
            >
              {emailError}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.name}>{t("subscribe.name")}</Label>
          <Input
            id={ids.name}
            data-testid="subscribe-form-name"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.branch}>{t("subscribe.branch")}</Label>
        <select
          id={ids.branch}
          data-testid="subscribe-form-branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="block h-11 w-full max-w-sm rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("subscribe.allBranches")}</option>
          {branchList.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <Honeypot
        id={`${uid}-website`}
        testId="subscribe-form-honeypot"
        value={honeypot}
        onChange={setHoneypot}
      />
      {siteKey && (
        <TurnstileWidget
          siteKey={siteKey}
          onToken={setToken}
          resetSignal={resetSignal}
          testId="subscribe-form-turnstile"
        />
      )}
      <p id={ids.consent} className="text-sm text-muted-foreground">
        {t("subscribe.consent")}{" "}
        <Link
          to="/privacy/attendees"
          target="_blank"
          data-testid="subscribe-form-privacy-link"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {t("attendeePrivacy.link")}
        </Link>
      </p>
      {formError && (
        <p
          id={ids.error}
          role="alert"
          data-testid="subscribe-form-error"
          className="text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <Button
        type="submit"
        data-testid="subscribe-form-submit"
        className="h-11"
        disabled={busy || config.isPending}
        aria-describedby={formError ? ids.error : undefined}
      >
        {busy ? t("guest.sending") : t("subscribe.submit")}
      </Button>
    </form>
  );
}
