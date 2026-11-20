import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Trans, useTranslation } from "react-i18next";
import { deleteUser } from "@/lib/delete-user.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Target = { id: string; fullName: string; requestId?: string | null };

export function DeleteUserDialog({ target, onClose, onDeleted }: { target: Target | null; onClose: () => void; onDeleted: () => void }) {
  const run = useServerFn(deleteUser);
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = target?.fullName.trim() ?? "";
  const matches = name !== "" && typed.trim() === name;

  async function confirm() {
    if (!target || !matches) return;
    setBusy(true); setError("");
    try {
      await run({ data: { userId: target.id, requestId: target.requestId ?? null } });
      toast.success(t("userDetails.userDeleted"));
      setTyped("");
      onDeleted();
    } catch (e) { setError(translateError(e)); }
    finally { setBusy(false); }
  }

  return <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) { setTyped(""); setError(""); onClose(); } }}>
    <DialogContent data-testid="delete-user-dialog" className="max-w-[calc(100%-2rem)] sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("userDetails.deleteTitle")}</DialogTitle>
        <DialogDescription>{t("userDetails.deleteText", { name: name || t("userDetails.thisUser") })}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="confirm-name"><Trans i18nKey="userDetails.typeToConfirm" values={{ name: name || t("userDetails.theFullName") }} components={{ bold: <span className="font-semibold" /> }} /></Label>
        <Input data-testid="delete-user-name-input" id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11" disabled={!name} />
        {!name && <p className="text-sm text-muted-foreground">{t("userDetails.noNameText")}</p>}
      </div>
      {error && <p data-testid="delete-user-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2">
        <Button data-testid="confirm-dialog-cancel-button" variant="outline" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
        <Button data-testid="confirm-dialog-confirm-button" variant="destructive" disabled={busy || !matches} onClick={confirm}>{busy ? t("userDetails.deleting") : t("userDetails.deletePermanently")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
