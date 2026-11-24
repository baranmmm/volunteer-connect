import { useId, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
import { registerGuest } from "@/lib/public-guest.functions";
import { translateError } from "@/lib/i18n";
import type { PublicEvent } from "@/lib/public-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  EMAIL_PATTERN,
  Honeypot,
  TurnstileWidget,
  usePublicFormConfig,
  waitForMinFill,
} from "./form-protection";

type FieldErrors = Partial<Record<"name" | "email", string>>;

/**
 * Registration without an account (signed-out visitors, open or full events). The answer is always "check your
 * email": the confirmation link takes the seat (or a waitlist place), so nobody learns who is registered.
 */
export function GuestRegistrationForm({ event }: { event: PublicEvent }) {
  const { t } = useTranslation();
  const uid = useId();
  const config = usePublicFormConfig();
  const submit = useServerFn(registerGuest);
  const full = event.registration === "full";
  const maxPlaces = event.max_places ?? 1;
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [places, setPlaces] = useState(1),
    [keepInformed, setKeepInformed] = useState(false),
    [honeypot, setHoneypot] = useState(""),
    [token, setToken] = useState<string | null>(null),
    [resetSignal, setResetSignal] = useState(0),
    [errors, setErrors] = useState<FieldErrors>({}),
    [formError, setFormError] = useState(""),
    [busy, setBusy] = useState(false),
    [sentTo, setSentTo] = useState<string | null>(null);
  const siteKey = config.data?.turnstileSiteKey ?? null;
  const ids = {
    name: `${uid}-name`,
    email: `${uid}-email`,
    phone: `${uid}-phone`,
    places: `${uid}-places`,
    keep: `${uid}-keep`,
    error: `${uid}-error`,
  };

  if (sentTo) {
    return (
      <section
        data-testid="guest-form-sent"
        aria-live="polite"
        className="space-y-3 rounded-2xl border bg-card p-5"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MailCheck className="size-5 text-primary" aria-hidden />
          {t("guest.sentTitle")}
        </h2>
        <p className="text-sm">{t("guest.sentBody", { email: sentTo })}</p>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid="guest-form-again"
          onClick={() => {
            setSentTo(null);
            setResetSignal((n) => n + 1);
          }}
        >
          {t("guest.again")}
        </Button>
      </section>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    const next: FieldErrors = {};
    if (!name.trim()) next.name = t("guest.errors.nameRequired");
    if (!EMAIL_PATTERN.test(email.trim())) next.email = t("guest.errors.emailInvalid");
    setErrors(next);
    if (Object.keys(next).length) return;
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
      await submit({
        data: {
          eventId: event.id,
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          places: maxPlaces > 1 ? places : 1,
          keepInformed,
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

  const describedBy = (field: keyof FieldErrors) =>
    errors[field] ? `${ids[field]}-error` : undefined;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5" aria-labelledby={`${uid}-title`}>
      <div className="space-y-1">
        <h2 id={`${uid}-title`} className="text-lg font-semibold">
          {t(full ? "guest.waitlistTitle" : "guest.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(full ? "guest.waitlistIntro" : "guest.intro")}
        </p>
      </div>
      <form
        data-testid="guest-form"
        data-state={full ? "full" : "open"}
        noValidate
        onSubmit={onSubmit}
        className="relative space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor={ids.name}>{t("guest.name")}</Label>
          <Input
            id={ids.name}
            data-testid="guest-form-name"
            autoComplete="name"
            maxLength={120}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name}
            aria-describedby={describedBy("name")}
            className="h-11"
          />
          {errors.name && (
            <p
              id={`${ids.name}-error`}
              data-testid="guest-form-name-error"
              className="text-sm text-destructive"
            >
              {errors.name}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.email}>{t("guest.email")}</Label>
          <Input
            id={ids.email}
            data-testid="guest-form-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={describedBy("email")}
            className="h-11"
          />
          {errors.email && (
            <p
              id={`${ids.email}-error`}
              data-testid="guest-form-email-error"
              className="text-sm text-destructive"
            >
              {errors.email}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.phone}>{t("guest.phone")}</Label>
          <Input
            id={ids.phone}
            data-testid="guest-form-phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-11"
          />
        </div>
        {maxPlaces > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor={ids.places}>{t("guest.places")}</Label>
            <select
              id={ids.places}
              data-testid="guest-form-places"
              value={places}
              onChange={(e) => setPlaces(Number(e.target.value))}
              className="block h-11 w-32 rounded-xl border border-input bg-background px-3 text-sm"
            >
              {Array.from({ length: maxPlaces }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-start gap-3">
          <Checkbox
            id={ids.keep}
            data-testid="guest-form-keep-informed"
            checked={keepInformed}
            onCheckedChange={(v) => setKeepInformed(v === true)}
            className="mt-0.5 size-5"
          />
          <Label htmlFor={ids.keep} className="font-normal leading-snug">
            {t("guest.keepInformed")}
          </Label>
        </div>
        <Honeypot
          id={`${uid}-website`}
          testId="guest-form-honeypot"
          value={honeypot}
          onChange={setHoneypot}
        />
        {siteKey && (
          <TurnstileWidget
            siteKey={siteKey}
            onToken={setToken}
            resetSignal={resetSignal}
            testId="guest-form-turnstile"
          />
        )}
        <p className="text-sm text-muted-foreground">
          {t("guest.privacy")}{" "}
          <Link
            to="/privacy/attendees"
            target="_blank"
            data-testid="guest-form-privacy-link"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t("attendeePrivacy.link")}
          </Link>
        </p>
        {formError && (
          <p
            id={ids.error}
            role="alert"
            data-testid="guest-form-error"
            className="text-sm text-destructive"
          >
            {formError}
          </p>
        )}
        <Button
          type="submit"
          data-testid="guest-form-submit"
          className="h-11"
          disabled={busy || config.isPending}
          aria-describedby={formError ? ids.error : undefined}
        >
          {busy ? t("guest.sending") : t(full ? "guest.submitWaitlist" : "guest.submit")}
        </Button>
      </form>
    </section>
  );
}
