import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput, MIN_PASSWORD_LENGTH } from "@/components/app/PasswordInput";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/app/Logo";
import { LanguageToggle } from "@/components/app/LanguageToggle";
import { useTranslation } from "react-i18next";
import { translateError } from "@/lib/i18n";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Choose a new password for your volunteer account." },
      { property: "og:title", content: "Set a new password · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Choose a new password for your volunteer account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirm) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error(translateError(error)); return; }
    toast.success(t("auth.passwordUpdated"));
    navigate({ to: "/dashboard", replace: true });
  }
  return (
    <div className="relative flex min-h-screen items-center justify-center px-5">
      <LanguageToggle className="absolute right-4 top-4" />
      <form onSubmit={submit} className="w-full max-w-md space-y-5">
        <Logo variant="auth" />
        <h1 className="text-3xl font-bold">{t("auth.setNewTitle")}</h1>
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.newPassword")}</Label>
          <PasswordInput data-testid="auth-password-input" id="password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required aria-describedby="password-help" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl" />
          <p id="password-help" className="text-sm text-muted-foreground">{t("auth.passwordHelp", { count: MIN_PASSWORD_LENGTH })}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
          <PasswordInput data-testid="auth-confirm-password-input" id="confirm" name="confirm" autoComplete="new-password" required aria-invalid={mismatch} aria-describedby={mismatch ? "confirm-error" : undefined} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12 rounded-xl" />
          {mismatch && <p data-testid="auth-error-message" id="confirm-error" role="alert" className="text-sm font-medium text-destructive">{t("auth.passwordsDontMatch")}</p>}
        </div>
        <Button data-testid="auth-submit-button" type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={busy || password !== confirm}>{t("auth.updatePassword")}</Button>
      </form>
    </div>
  );
}
