import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from '@tanstack/react-query';
import { toast } from "@/lib/toast";
import { Trans, useTranslation } from "react-i18next";
import { deleteUser } from "@/lib/delete-user.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Target = { id: string; fullName: string; requestId?: string | null };

export function DeleteUserDialog({ target, onClose, onDeleted }: { target: Target | null; onClose: () => void; onDeleted: () => void }) {
  const run = useServerFn(deleteUser);
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const name = target?.fullName.trim() ?? "";
  const isErasureRequest = Boolean(target?.requestId);
  const nameConfirmed = name.length > 0 && confirmationName.trim() === name;

  useEffect(() => {
    setConfirmationName("");
    setError("");
  }, [target?.id, target?.requestId]);

  async function confirm() {
    if (!target || (isErasureRequest && !nameConfirmed)) return;
    setBusy(true); setError("");
    try {
      await run({ data: { userId: target.id, requestId: target.requestId ?? null } });
      await qc.invalidateQueries({ queryKey: ['recycle-bin'] });
      toast.success(t("userDetails.userDeleted"));
      setConfirmationName("");
      onDeleted();
    } catch (e) { setError(translateError(e)); }
    finally { setBusy(false); }
  }

  return <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) { setError(""); setConfirmationName(""); onClose(); } }}>
    <DialogContent data-testid="delete-user-dialog" className="max-w-[calc(100%-2rem)] sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("userDetails.deleteTitle")}</DialogTitle>
        <DialogDescription>{t(isErasureRequest ? "userDetails.deleteRequestText" : "userDetails.deleteText", { name: name || t("userDetails.thisUser") })}</DialogDescription>
      </DialogHeader>
      {isErasureRequest && <>
        <p className="text-sm text-muted-foreground">{t('recycleBin.selfRequestNote')}</p>
        {name ? <div className="grid gap-2 text-left">
          <Label htmlFor="delete-user-name-input"><Trans i18nKey="userDetails.typeToConfirm" values={{ name }} components={{ bold: <span className="font-semibold" /> }} /></Label>
          <Input id="delete-user-name-input" data-testid="delete-user-name-input" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} disabled={busy} autoComplete="off" autoFocus />
        </div> : <p className="text-sm text-destructive">{t("userDetails.noNameText")}</p>}
      </>}
      {error && <p data-testid="delete-user-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2">
        <Button data-testid="confirm-dialog-cancel-button" variant="outline" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
        <Button data-testid="confirm-dialog-confirm-button" variant="destructive" disabled={busy || !target || (isErasureRequest && !nameConfirmed)} onClick={confirm}>{busy ? t("userDetails.deleting") : t("recycleBin.delete")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
