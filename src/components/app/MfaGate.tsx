import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Current assurance level and the verified TOTP factor, if any. */
export function useMfaStatus(enabled: boolean, userId: string | undefined) {
  return useQuery({
    queryKey: ["mfa-status", userId],
    enabled: enabled && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const [aal, factors] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
      if (aal.error) throw aal.error;
      if (factors.error) throw factors.error;
      const verified = factors.data.totp.find((f) => f.status === "verified") ?? null;
      return { aal2: aal.data.currentLevel === "aal2", factorId: verified?.id ?? null };
    },
  });
}

const CODE = /^\d{6}$/;

function CodeForm({ onSubmit, busy, error, testId }: { onSubmit: (code: string) => void; busy: boolean; error: string; testId: string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (CODE.test(code)) onSubmit(code);
  }
  return (
    <form onSubmit={submit} className="space-y-3" data-testid={`${testId}-form`}>
      <Label htmlFor={`${testId}-code`}>{t("mfa.code")}</Label>
      <Input id={`${testId}-code`} data-testid="mfa-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-12 max-w-48 text-lg tracking-widest" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button data-testid="mfa-submit" type="submit" className="h-11" disabled={busy || !CODE.test(code)}>
        {busy ? t("common.saving") : t("mfa.verify")}
      </Button>
    </form>
  );
}

/** Sets up a TOTP authenticator: QR code (and the key for manual entry), then the first code. */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [enrolment, setEnrolment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      // Unfinished set-ups are removed first, so a new QR code can always be shown.
      const factors = await supabase.auth.mfa.listFactors();
      for (const f of factors.data?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Volunteer Hub ${new Date().toISOString().slice(0, 10)}` });
      if (e) throw e;
      setEnrolment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(code: string) {
    if (!enrolment) return;
    setBusy(true);
    setError("");
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolment.id, code });
    setBusy(false);
    if (e) { setError(t("mfa.wrongCode")); return; }
    onDone();
  }
  return (
    <section data-testid="mfa-setup" className="space-y-4">
      <p className="text-muted-foreground">{t("mfa.setupIntro")}</p>
      {!enrolment ? (
        <>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button data-testid="mfa-setup-start" className="h-11" disabled={busy} onClick={() => void start()}>{t("mfa.setupStart")}</Button>
        </>
      ) : (
        <>
          <img src={enrolment.qr} alt={t("mfa.qrAlt")} data-testid="mfa-qr" className="h-48 w-48 rounded-lg border bg-white p-2" />
          <p className="text-sm">{t("mfa.manualKey")} <code data-testid="mfa-secret" className="break-all rounded bg-muted px-1">{enrolment.secret}</code></p>
          <CodeForm onSubmit={(c) => void verify(c)} busy={busy} error={error} testId="mfa-setup" />
        </>
      )}
    </section>
  );
}

/** The second sign-in step: a code from the authenticator app. */
export function MfaVerify({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify(code: string) {
    setBusy(true);
    setError("");
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (e) { setError(t("mfa.wrongCode")); return; }
    onDone();
  }
  return (
    <section data-testid="mfa-verify" className="space-y-4">
      <p className="text-muted-foreground">{t("mfa.verifyIntro")}</p>
      <CodeForm onSubmit={(c) => void verify(c)} busy={busy} error={error} testId="mfa-verify" />
    </section>
  );
}

/** Shown instead of the app to a National Coordinator without an aal2 session (the server refuses everything else). */
export function MfaScreen({ factorId, userId, onSignOut }: { factorId: string | null; userId: string; onSignOut: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const done = async () => {
    await supabase.auth.refreshSession();
    await qc.invalidateQueries();
    await qc.refetchQueries({ queryKey: ["mfa-status", userId] });
  };
  return (
    <main data-testid="mfa-gate" className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <header className="flex items-start gap-3">
        <ShieldCheck className="mt-1 size-7 shrink-0 text-primary" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold">{t("mfa.title")}</h1>
          <p className="text-muted-foreground">{t("mfa.required")}</p>
        </div>
      </header>
      {factorId ? <MfaVerify factorId={factorId} onDone={() => void done()} /> : <MfaSetup onDone={() => void done()} />}
      <Button data-testid="mfa-signout" variant="outline" className="h-11" onClick={onSignOut}>
        <LogOut />
        {t("navigation.signOut")}
      </Button>
    </main>
  );
}
