import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { useRedirect } from "@/lib/use-redirect";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchRegionGroups, type RegionGroup } from "@/lib/branches";
import { Logo } from "@/components/app/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput, MIN_PASSWORD_LENGTH } from "@/components/app/PasswordInput";
import { LanguageToggle } from "@/components/app/LanguageToggle";
import { useTranslation } from "react-i18next";
import { currentLang, translateError } from "@/lib/i18n";
import { CircleCheck } from "lucide-react";
import { VolunteerAnswerFields } from "@/components/requests/VolunteerAnswerFields";
import {
  EMPTY_ANSWERS,
  signUpApplication,
  validateVolunteerAnswers,
  type VolunteerAnswerErrors,
  type VolunteerAnswers,
} from "@/lib/volunteer-applications";

const JOIN_CHOICES = ["follower", "volunteer"] as const;
type JoinChoice = (typeof JOIN_CHOICES)[number];

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Sign in or create your volunteer account." },
      { property: "og:title", content: "Sign in · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Sign in or create your volunteer account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // ?redirect=/events/<id> returns there after signing in; ?mode=signup opens the sign-up form.
  validateSearch: (search: Record<string, unknown>): { redirect?: string; mode?: "signup" } => ({
    ...(typeof search["redirect"] === "string" && safeRedirect(search["redirect"])
      ? { redirect: search["redirect"] }
      : {}),
    ...(search["mode"] === "signup" ? { mode: "signup" as const } : {}),
  }),
  component: AuthPage,
});

/** Only in-app paths of public events (never another origin). */
function safeRedirect(path: string) {
  return /^\/events\/[0-9a-f-]{36}$/i.test(path);
}

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const { session, loading } = useAuth();
  const search = Route.useSearch();
  const [mode, setMode] = useState<Mode>(search.mode === "signup" ? "signup" : "signin");
  const { t } = useTranslation();
  const navigate = useNavigate();
  useRedirect(!loading && !!session && !search.redirect, "/dashboard");
  useEffect(() => {
    if (!loading && session && search.redirect)
      void navigate({ to: search.redirect, replace: true });
  }, [loading, session, search.redirect, navigate]);
  if (!loading && session) return null;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[11fr_9fr]">
      <AuthHero join={mode === "signup"} />
      <main className="relative flex justify-center px-5 pb-16 pt-8 lg:items-center lg:py-16">
        <LanguageToggle className="absolute right-4 top-4" />
        <div className="w-full max-w-md">
          <Logo variant="auth" className="mb-6 mt-8 lg:mt-0" />
          {mode === "signin" && <SignIn setMode={setMode} />}
          {mode === "signup" && <SignUp setMode={setMode} />}
          {mode === "forgot" && <Forgot setMode={setMode} />}
        </div>
      </main>
    </div>
  );
}

/** Optimised copies of two Dialogue Society event photos (public/auth): sign-in and join. */
const HERO_IMAGES = {
  signin: { alt: "auth.heroAltSignIn", large: 1500, width: 1500, height: 1000 },
  join: { alt: "auth.heroAltJoin", large: 1600, width: 1600, height: 1067 },
} as const;

/** Desktop: the photo fills the left column with the hub's message; mobile: a short banner above the form. */
function AuthHero({ join }: { join: boolean }) {
  const { t } = useTranslation();
  const name = join ? "join" : "signin";
  const image = HERO_IMAGES[name];
  return (
    <div className="relative h-40 overflow-hidden bg-sidebar sm:h-56 lg:sticky lg:top-0 lg:h-screen">
      {/* Only the photo of the current mode is in the page, so it alone loads eagerly with high priority. */}
      <img
        key={name}
        data-testid="auth-hero-image"
        data-image={name}
        src={`/auth/${name}-800.webp`}
        srcSet={`/auth/${name}-800.webp 800w, /auth/${name}-1600.webp ${image.large}w`}
        sizes="(min-width: 1024px) 55vw, 100vw"
        width={image.width}
        height={image.height}
        alt={t(image.alt)}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-sidebar/90 via-sidebar/35 to-sidebar/10"
      />
      <div className="relative hidden h-full flex-col justify-end gap-4 p-12 text-white lg:flex">
        <p className="max-w-xl text-4xl font-bold leading-tight">{t("auth.heroTitle")}</p>
        <p className="max-w-md text-lg">{t("auth.heroText")}</p>
        <p className="text-sm">{t("auth.charity")}</p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  ...props
}: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-12 rounded-xl" {...props} />
    </div>
  );
}

function SignIn({ setMode }: { setMode: (m: Mode) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setBusy(false);
    if (error) toast.error(translateError(error));
  }
  return (
    <form data-testid="auth-sign-in-form" onSubmit={submit} className="space-y-5">
      <div>
        <p data-testid="auth-signin-welcome" className="text-lg text-muted-foreground">
          {t("auth.signInWelcome")}
        </p>
        <h1 className="mt-4 text-3xl font-semibold">{t("auth.signIn")}</h1>
      </div>
      <Field
        id="email"
        name="email"
        type="email"
        label={t("auth.email")}
        data-testid="auth-email-input"
        autoComplete="email"
        required
      />
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <PasswordInput
          data-testid="auth-password-input"
          id="password"
          name="password"
          autoComplete="current-password"
          required
          className="h-12 rounded-xl"
        />
      </div>
      <Button
        data-testid="auth-submit-button"
        type="submit"
        size="lg"
        className="h-12 w-full rounded-xl"
        disabled={busy}
      >
        {busy ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          data-testid="auth-forgot-password-link"
          type="button"
          className="min-h-11 font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => setMode("forgot")}
        >
          {t("auth.forgot")}
        </button>
        <button
          type="button"
          className="min-h-11 font-medium text-primary underline-offset-4 hover:underline"
          data-testid="auth-toggle-mode-link"
          onClick={() => setMode("signup")}
        >
          {t("auth.createAccountLink")}
        </button>
      </div>
    </form>
  );
}

function SignUp({ setMode }: { setMode: (m: Mode) => void }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<RegionGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;
  // The privacy notice must be confirmed (the server refuses the account otherwise); the two consents are optional.
  const [privacyRead, setPrivacyRead] = useState(false),
    [privacyError, setPrivacyError] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false),
    [updatesConsent, setUpdatesConsent] = useState(false);
  // Follower or volunteer: no default, the form is not sent until one is chosen. The volunteer choice adds the
  // application answers (the database checks the same rules and creates the application with the account).
  const [choice, setChoice] = useState<JoinChoice | null>(null),
    [choiceError, setChoiceError] = useState(false);
  const [answers, setAnswers] = useState<VolunteerAnswers>(EMPTY_ANSWERS),
    [answerErrors, setAnswerErrors] = useState<VolunteerAnswerErrors>({});
  useEffect(() => {
    fetchRegionGroups()
      .then(setGroups)
      .catch(() => toast.error(t("errors.branchesLoad")));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const branch_id = String(f.get("branch") || "");
    if (password !== confirm) return;
    if (!choice) {
      setChoiceError(true);
      document.getElementById("signup-choice-follower")?.focus();
      return;
    }
    if (choice === "volunteer") {
      const found = validateVolunteerAnswers(answers);
      setAnswerErrors(found);
      const first = (["help", "time", "commitment"] as const).find((k) => found[k]);
      if (first) {
        const target =
          first === "time"
            ? document.querySelector<HTMLInputElement>('input[name="signup-volunteer-time"]')
            : document.getElementById(`signup-volunteer-${first}`);
        target?.focus();
        return;
      }
    }
    if (!branch_id) {
      toast.error(t("errors.chooseBranch"));
      return;
    }
    if (!privacyRead) {
      setPrivacyError(true);
      document.getElementById("signup-privacy")?.focus();
      return;
    }
    setBusy(true);
    const version = await supabase.rpc("privacy_notice_version");
    if (version.error || !version.data) {
      setBusy(false);
      toast.error(translateError(version.error));
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: String(f.get("full_name")),
          phone: String(f.get("phone")),
          branch_id,
          preferred_language: currentLang(),
          privacy_notice_version: version.data,
          photo_consent: photoConsent,
          updates_email_consent: updatesConsent,
          ...(choice === "volunteer" ? { volunteer_application: signUpApplication(answers) } : {}),
        },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(translateError(error));
      return;
    }
    if (!data.session) setDone(true);
  }

  if (done) {
    return (
      <div data-testid="auth-check-email-screen" className="space-y-4">
        <h1 className="text-3xl font-semibold">{t("auth.checkEmailTitle")}</h1>
        <p className="text-muted-foreground">{t("auth.checkEmailText")}</p>
        <Button
          data-testid="auth-back-to-sign-in-button"
          variant="outline"
          className="h-12 rounded-xl"
          onClick={() => setMode("signin")}
        >
          {t("auth.backToSignIn")}
        </Button>
      </div>
    );
  }

  return (
    <form data-testid="auth-sign-up-form" onSubmit={submit} className="space-y-4">
      <section
        data-testid="auth-join-intro"
        aria-labelledby="auth-join-title"
        className="space-y-3"
      >
        <h1 id="auth-join-title" className="text-3xl font-semibold leading-tight">
          {t("auth.joinCopy.title")}
        </h1>
        <p className="text-muted-foreground">{t("auth.joinCopy.text")}</p>
        <ul className="space-y-2">
          {(["point1", "point2", "point3"] as const).map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>{t(`auth.joinCopy.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t("auth.joinCopy.choose")}</p>
      </section>
      <fieldset
        aria-describedby={choiceError ? "signup-choice-error" : undefined}
        className="space-y-3"
      >
        <legend className="mb-3 text-lg font-semibold">{t("auth.choice.legend")}</legend>
        {JOIN_CHOICES.map((option) => (
          <label
            key={option}
            data-testid={`signup-choice-${option}`}
            data-state={choice === option ? "checked" : "unchecked"}
            className="flex cursor-pointer gap-3 rounded-2xl border-2 bg-card p-4 transition-colors hover:border-primary/60 has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring"
          >
            <input
              id={`signup-choice-${option}`}
              type="radio"
              name="join_choice"
              value={option}
              checked={choice === option}
              onChange={() => {
                setChoice(option);
                setChoiceError(false);
              }}
              aria-describedby={`signup-choice-${option}-text`}
              className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span className="space-y-1">
              <span className="block font-semibold">{t(`auth.choice.${option}.title`)}</span>
              <span
                id={`signup-choice-${option}-text`}
                className="block text-sm text-muted-foreground"
              >
                {t(`auth.choice.${option}.text`)} {t(`auth.choice.${option}.note`)}
              </span>
            </span>
          </label>
        ))}
        {choiceError && (
          <p
            id="signup-choice-error"
            data-testid="signup-choice-error"
            role="alert"
            className="text-sm font-medium text-destructive"
          >
            {t("auth.choice.required")}
          </p>
        )}
      </fieldset>
      {choice === "volunteer" && (
        <section
          data-testid="signup-volunteer-answers"
          aria-labelledby="signup-volunteer-title"
          className="space-y-3 rounded-2xl border p-4"
        >
          <h2 id="signup-volunteer-title" className="text-lg font-semibold">
            {t("auth.volunteerAnswersTitle")}
          </h2>
          <VolunteerAnswerFields
            prefix="signup-volunteer"
            value={answers}
            errors={answerErrors}
            onChange={(next) => {
              setAnswers(next);
              if (Object.keys(answerErrors).length) setAnswerErrors(validateVolunteerAnswers(next));
            }}
          />
        </section>
      )}
      <h2 className="pt-2 text-lg font-semibold">{t("auth.createAccountTitle")}</h2>
      <Field
        id="full_name"
        name="full_name"
        label={t("auth.fullName")}
        data-testid="auth-full-name-input"
        autoComplete="name"
        required
      />
      <Field
        id="email"
        name="email"
        type="email"
        label={t("auth.email")}
        data-testid="auth-email-input"
        autoComplete="email"
        required
      />
      <Field
        id="phone"
        name="phone"
        type="tel"
        label={t("auth.phone")}
        data-testid="auth-phone-input"
        autoComplete="tel"
        required
      />
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <PasswordInput
          data-testid="auth-password-input"
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          aria-describedby="password-help"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 rounded-xl"
        />
        <p id="password-help" className="text-sm text-muted-foreground">
          {t("auth.passwordHelp", { count: MIN_PASSWORD_LENGTH })}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
        <PasswordInput
          data-testid="auth-confirm-password-input"
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "confirm-error" : undefined}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-12 rounded-xl"
        />
        {mismatch && (
          <p
            data-testid="auth-error-message"
            id="confirm-error"
            role="alert"
            className="text-sm font-medium text-destructive"
          >
            {t("auth.passwordsDontMatch")}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="branch">{t("auth.followBranch")}</Label>
        <select
          data-testid="signup-branch-select"
          aria-describedby="branch-help"
          id="branch"
          name="branch"
          required
          defaultValue=""
          className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <option value="" disabled>
            {t("auth.chooseBranch")}
          </option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p id="branch-help" className="text-sm text-muted-foreground">
          {t("auth.followBranchHelp")}
        </p>
      </div>
      <fieldset className="space-y-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">{t("privacy.signupLegend")}</legend>
        <div className="flex items-start gap-3">
          <Checkbox
            id="signup-privacy"
            data-testid="signup-privacy-checkbox"
            checked={privacyRead}
            aria-required
            aria-invalid={privacyError}
            aria-describedby={privacyError ? "signup-privacy-error" : undefined}
            onCheckedChange={(v) => {
              setPrivacyRead(v === true);
              setPrivacyError(false);
            }}
          />
          <Label htmlFor="signup-privacy" className="leading-snug">
            {t("privacy.signupRead")}{" "}
            <Link
              to="/privacy"
              target="_blank"
              className="font-medium text-primary underline underline-offset-4"
            >
              {t("privacy.noticeLink")}
            </Link>{" "}
            *
          </Label>
        </div>
        {privacyError && (
          <p
            id="signup-privacy-error"
            role="alert"
            className="text-sm font-medium text-destructive"
          >
            {t("privacy.signupRequired")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("privacy.optionalIntro")}</p>
        <div className="flex items-start gap-3">
          <Checkbox
            id="signup-photo"
            data-testid="signup-photo-consent"
            checked={photoConsent}
            onCheckedChange={(v) => setPhotoConsent(v === true)}
          />
          <Label htmlFor="signup-photo" className="leading-snug">
            {t("privacy.photoConsent")}
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="signup-updates"
            data-testid="signup-updates-consent"
            checked={updatesConsent}
            onCheckedChange={(v) => setUpdatesConsent(v === true)}
          />
          <Label htmlFor="signup-updates" className="leading-snug">
            {t("privacy.updatesConsent")}
          </Label>
        </div>
      </fieldset>
      <Button
        data-testid="auth-submit-button"
        type="submit"
        size="lg"
        className="h-12 w-full rounded-xl"
        disabled={busy || password !== confirm}
      >
        {busy ? t("auth.creatingAccount") : t("auth.createAccount")}
      </Button>
      <button
        data-testid="auth-toggle-mode-link"
        type="button"
        className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline"
        onClick={() => setMode("signin")}
      >
        {t("auth.haveAccount")}
      </button>
    </form>
  );
}

function Forgot({ setMode }: { setMode: (m: Mode) => void }) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.auth.resetPasswordForEmail(String(f.get("email")), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(translateError(error));
    else setSent(true);
  }
  return (
    <form data-testid="auth-forgot-form" onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">{t("auth.resetTitle")}</h1>
        <p
          data-testid={sent ? "auth-reset-sent-message" : undefined}
          className="mt-1 text-muted-foreground"
        >
          {sent ? t("auth.resetSent") : t("auth.resetIntro")}
        </p>
      </div>
      {!sent && (
        <Field
          id="email"
          name="email"
          type="email"
          label={t("auth.email")}
          data-testid="auth-email-input"
          required
        />
      )}
      {!sent && (
        <Button
          data-testid="auth-submit-button"
          type="submit"
          size="lg"
          className="h-12 w-full rounded-xl"
        >
          {t("auth.sendReset")}
        </Button>
      )}
      <button
        data-testid="auth-back-to-sign-in-button"
        type="button"
        className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline"
        onClick={() => setMode("signin")}
      >
        {t("auth.backToSignIn")}
      </button>
    </form>
  );
}
