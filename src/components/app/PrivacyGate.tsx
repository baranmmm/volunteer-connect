import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { LogOut, ShieldCheck } from "lucide-react";
import { acceptPrivacyNotice, type PrivacyStatus } from "@/lib/privacy.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PrivacyNotice } from "./PrivacyNotice";

/** Shown instead of the app until the member confirms the current privacy notice version. */
export function PrivacyGate({
  status,
  onSignOut,
}: {
  status: PrivacyStatus;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const accept = useServerFn(acceptPrivacyNotice);
  const [read, setRead] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await accept({ data: { version: status.current_version } });
      await qc.invalidateQueries();
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      data-testid="privacy-gate"
      data-version={status.current_version}
      className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6"
    >
      <header className="flex items-start gap-3">
        <ShieldCheck className="mt-1 size-7 shrink-0 text-primary" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold">{t("privacy.gateTitle")}</h1>
          <p className="text-muted-foreground">
            {status.accepted_version
              ? t("privacy.gateUpdated", { version: status.current_version })
              : t("privacy.gateFirst")}
          </p>
        </div>
      </header>
      <section
        aria-label={t("privacy.noticeLabel")}
        tabIndex={0}
        className="max-h-[55dvh] overflow-y-auto rounded-lg border bg-card p-4 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PrivacyNotice headingLevel={2} />
      </section>
      <div className="flex items-start gap-3">
        <Checkbox
          id="privacy-gate-read"
          data-testid="privacy-gate-read"
          checked={read}
          onCheckedChange={(v) => setRead(v === true)}
        />
        <Label htmlFor="privacy-gate-read" className="leading-snug">
          {t("privacy.readAndUnderstood")}
        </Label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          data-testid="privacy-gate-accept"
          className="h-11"
          disabled={!read || busy}
          onClick={() => void confirm()}
        >
          {busy ? t("common.saving") : t("privacy.confirm")}
        </Button>
        <Button
          data-testid="privacy-gate-signout"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={onSignOut}
        >
          <LogOut />
          {t("navigation.signOut")}
        </Button>
      </div>
    </main>
  );
}
