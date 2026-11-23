import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { deleteMyFollowerAccount } from "@/lib/delete-user.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/**
 * Followers delete their own account straight away (no manager processes it): they type their full name to confirm.
 * The erasure cannot be undone; the account is signed out at once.
 */
export function FollowerDeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const remove = useServerFn(deleteMyFollowerAccount);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = profile?.full_name.trim() ?? "";
  async function confirm() {
    setBusy(true);
    try {
      await remove({ data: { confirmName: name } });
      toast.success(t("profile.followerDeleted"));
      await signOut();
      await navigate({ to: "/auth", replace: true });
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy && !o) onClose();
      }}
    >
      <DialogContent
        data-testid="follower-delete-dialog"
        className="max-w-[calc(100%-2rem)] sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("profile.followerDeleteTitle")}</DialogTitle>
          <DialogDescription>{t("profile.followerDeleteText")}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="follower-delete-name">
          {t("profile.typeYourName", { name: expected })}
        </Label>
        <Input
          id="follower-delete-name"
          data-testid="follower-delete-name-input"
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className="h-11"
        />
        <DialogFooter className="gap-2">
          <Button
            data-testid="confirm-dialog-cancel-button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            {t("profile.keepAccount")}
          </Button>
          <Button
            data-testid="follower-delete-confirm"
            variant="destructive"
            disabled={busy || !expected || name.trim() !== expected}
            onClick={() => void confirm()}
          >
            {busy ? t("profile.sending") : t("profile.deleteNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
