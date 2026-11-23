import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  fetchMyDeletionRequest,
  requestAccountDeletion,
  cancelAccountDeletion,
} from "@/lib/members";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The member's own account deletion request: shared by Profile and the privacy confirmation screen, so a member
 * who does not want to accept the notice can still ask for deletion. The RPCs do not require the notice.
 */
export function useAccountDeletion(userId: string | undefined, enabled: boolean) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const myRequest = useQuery({
    queryKey: ["my-deletion-request", userId],
    queryFn: () => fetchMyDeletionRequest(userId!),
    enabled: !!userId && enabled,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run(kind: "request" | "cancel") {
    setBusy(true);
    try {
      if (kind === "request") await requestAccountDeletion();
      else await cancelAccountDeletion();
      toast.success(kind === "request" ? t("profile.requestSent") : t("profile.requestCancelled"));
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ["my-deletion-request"] });
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  return { myRequest, confirmOpen, setConfirmOpen, busy, run };
}

export function AccountDeletionDialog({
  deletion,
}: {
  deletion: ReturnType<typeof useAccountDeletion>;
}) {
  const { t } = useTranslation();
  const { confirmOpen, setConfirmOpen, busy, run } = deletion;
  return (
    <Dialog
      open={confirmOpen}
      onOpenChange={(o) => {
        if (!busy) setConfirmOpen(o);
      }}
    >
      <DialogContent
        data-testid="profile-delete-confirm-dialog"
        className="max-w-[calc(100%-2rem)] sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("profile.confirmTitle")}</DialogTitle>
          <DialogDescription>{t("profile.confirmText")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            data-testid="confirm-dialog-cancel-button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmOpen(false)}
          >
            {t("profile.keepAccount")}
          </Button>
          <Button
            data-testid="confirm-dialog-confirm-button"
            variant="destructive"
            disabled={busy}
            onClick={() => void run("request")}
          >
            {busy ? t("profile.sending") : t("profile.requestDeletion")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
