import { createFileRoute } from "@tanstack/react-router";
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
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const { t } = useTranslation();
  useRedirect(!loading && !!session, "/dashboard");
  if (!loading && session) return null;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-hero p-12 text-primary-foreground lg:flex">
        <Logo />
        <div>
          <h1 className="text-4xl font-bold leading-tight">{t("auth.heroTitle")}</h1>
          <p className="mt-4 max-w-md text-lg opacity-90">{t("auth.heroText")}</p>
        </div>
        <p className="text-sm opacity-75">{t("auth.charity")}</p>
      </div>
      <div className="relative flex items-center justify-center px-5 py-16">
        <LanguageToggle className="absolute right-4 top-4" />
        <div className="w-full max-w-md">
          <Logo className="mb-8 text-primary lg:hidden" />
          {mode === "signin" && <SignIn setMode={setMode} />}
          {mode === "signup" && <SignUp setMode={setMode} />}
          {mode === "forgot" && <Forgot setMode={setMode} />}
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
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
        <h2 className="text-3xl font-semibold">{t("auth.welcomeBack")}</h2>
        <p className="mt-1 text-muted-foreground">{t("auth.signInIntro")}</p>
      </div>
      <Field id="email" name="email" type="email" label={t("auth.email")} data-testid="auth-email-input" autoComplete="email" required />
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <PasswordInput data-testid="auth-password-input" id="password" name="password" autoComplete="current-password" required className="h-12 rounded-xl" />
      </div>
      <Button data-testid="auth-submit-button" type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={busy}>
        {busy ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button data-testid="auth-forgot-password-link" type="button" className="min-h-11 font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("forgot")}>
          {t("auth.forgot")}
        </button>
        <button type="button" className="min-h-11 font-medium text-primary underline-offset-4 hover:underline" data-testid="auth-toggle-mode-link" onClick={() => setMode("signup")}>
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
  useEffect(() => {
    fetchRegionGroups().then(setGroups).catch(() => toast.error(t("errors.branchesLoad")));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const branch_id = String(f.get("branch") || "");
    if (password !== confirm) return;
    if (!branch_id) { toast.error(t("errors.chooseBranch")); return; }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: String(f.get("full_name")), phone: String(f.get("phone")), branch_id, preferred_language: currentLang() },
      },
    });
    setBusy(false);
    if (error) { toast.error(translateError(error)); return; }
    if (!data.session) setDone(true);
  }

  if (done) {
    return (
      <div data-testid="auth-check-email-screen" className="space-y-4">
        <h2 className="text-3xl font-semibold">{t("auth.checkEmailTitle")}</h2>
        <p className="text-muted-foreground">{t("auth.checkEmailText")}</p>
        <Button data-testid="auth-back-to-sign-in-button" variant="outline" className="h-12 rounded-xl" onClick={() => setMode("signin")}>{t("auth.backToSignIn")}</Button>
      </div>
    );
  }

  return (
    <form data-testid="auth-sign-up-form" onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-3xl font-semibold">{t("auth.joinTitle")}</h2>
        <p className="mt-1 text-muted-foreground">{t("auth.joinIntro")}</p>
      </div>
      <Field id="full_name" name="full_name" label={t("auth.fullName")} data-testid="auth-full-name-input" autoComplete="name" required />
      <Field id="email" name="email" type="email" label={t("auth.email")} data-testid="auth-email-input" autoComplete="email" required />
      <Field id="phone" name="phone" type="tel" label={t("auth.phone")} data-testid="auth-phone-input" autoComplete="tel" required />
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <PasswordInput data-testid="auth-password-input" id="password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required aria-describedby="password-help" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl" />
        <p id="password-help" className="text-sm text-muted-foreground">{t("auth.passwordHelp", { count: MIN_PASSWORD_LENGTH })}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
        <PasswordInput data-testid="auth-confirm-password-input" id="confirm" name="confirm" autoComplete="new-password" required aria-invalid={mismatch} aria-describedby={mismatch ? "confirm-error" : undefined} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12 rounded-xl" />
        {mismatch && <p data-testid="auth-error-message" id="confirm-error" role="alert" className="text-sm font-medium text-destructive">{t("auth.passwordsDontMatch")}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="branch">{t("auth.branch")}</Label>
        <select data-testid="auth-branch-select" id="branch" name="branch" required defaultValue="" className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
          <option value="" disabled>{t("auth.chooseBranch")}</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <Button data-testid="auth-submit-button" type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={busy || password !== confirm}>
        {busy ? t("auth.creatingAccount") : t("auth.createAccount")}
      </Button>
      <button data-testid="auth-toggle-mode-link" type="button" className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signin")}>
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
        <h2 className="text-3xl font-semibold">{t("auth.resetTitle")}</h2>
        <p data-testid={sent ? "auth-reset-sent-message" : undefined} className="mt-1 text-muted-foreground">
          {sent ? t("auth.resetSent") : t("auth.resetIntro")}
        </p>
      </div>
      {!sent && <Field id="email" name="email" type="email" label={t("auth.email")} data-testid="auth-email-input" required />}
      {!sent && <Button data-testid="auth-submit-button" type="submit" size="lg" className="h-12 w-full rounded-xl">{t("auth.sendReset")}</Button>}
      <button data-testid="auth-back-to-sign-in-button" type="button" className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signin")}>
        {t("auth.backToSignIn")}
      </button>
    </form>
  );
}
