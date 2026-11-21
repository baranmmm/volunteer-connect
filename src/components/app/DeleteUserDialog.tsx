import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { useTranslation } from "react-i18next";
import { deleteUser } from "@/lib/delete-user.functions";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Target = { id: string; fullName: string; requestId?: string | null };

export function DeleteUserDialog({ target, onClose, onDeleted }: { target: Target | null; onClose: () => void; onDeleted: () => void }) {
  const run = useServerFn(deleteUser);
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = target?.fullName.trim() ?? "";

  async function confirm() {
    if (!target) return;
    setBusy(true); setError("");
    try {
      await run({ data: { userId: target.id, requestId: target.requestId ?? null } });
      toast.success(t("userDetails.userDeleted"));
      onDeleted();
    } catch (e) { setError(translateError(e)); }
    finally { setBusy(false); }
  }

  return <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) { setError(""); onClose(); } }}>
    <DialogContent data-testid="delete-user-dialog" className="max-w-[calc(100%-2rem)] sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("userDetails.deleteTitle")}</DialogTitle>
        <DialogDescription>{t("userDetails.deleteText", { name: name || t("userDetails.thisUser") })}</DialogDescription>
      </DialogHeader>
      {target?.requestId && <p className="text-sm text-muted-foreground">{t('recycleBin.selfRequestNote')}</p>}
      {error && <p data-testid="delete-user-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2">
        <Button data-testid="confirm-dialog-cancel-button" variant="outline" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
        <Button data-testid="confirm-dialog-confirm-button" variant="destructive" disabled={busy || !target} onClick={confirm}>{busy ? t("userDetails.deleting") : t("recycleBin.delete")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
