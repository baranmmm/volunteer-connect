import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyDeletionRequest, requestAccountDeletion, cancelAccountDeletion } from "@/lib/members";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, primaryRole } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { formatDate, isLang, setLanguage, translateError, type Lang } from "@/lib/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { PrivacyPreferences } from "@/components/app/PrivacyPreferences";

export const Route = createFileRoute("/_app/profile")({
  head: () => pageHead("Profile", "Manage your volunteer profile."),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, roles, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isDirector = roles.includes("regional_director");
  const myRequest = useQuery({ queryKey: ["my-deletion-request", profile?.id], queryFn: () => fetchMyDeletionRequest(profile!.id), enabled: !!profile && !isDirector });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  if (!profile) return null;

  async function changeLanguage(value: string) {
    if (!isLang(value)) return;
    const previous = i18n.language as Lang;
    setLanguage(value as Lang);
    const { error } = await supabase.from("profiles").update({ preferred_language: value }).eq("id", profile!.id);
    if (error) { setLanguage(previous); toast.error(translateError(error)); return; }
    toast.success(i18n.t("profile.languageSaved", { lng: value }));
    refresh();
  }

  async function runDeletion(kind: "request" | "cancel") {
    setDeleteBusy(true);
    try {
      if (kind === "request") await requestAccountDeletion(); else await cancelAccountDeletion();
      toast.success(kind === "request" ? t("profile.requestSent") : t("profile.requestCancelled"));
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ["my-deletion-request"] });
    } catch (e) { toast.error(translateError(e)); }
    finally { setDeleteBusy(false); }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: String(f.get("full_name")).trim(), phone: String(f.get("phone")).trim() })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) { toast.error(translateError(error)); return; }
    toast.success(t("profile.saved"));
    refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("profile.title")}</h1>
      <section className="max-w-xl space-y-2 rounded-2xl border bg-card p-6 shadow-soft">
        <Label htmlFor="language">{t("profile.language")}</Label>
        <Select value={i18n.language} onValueChange={changeLanguage}>
          <SelectTrigger data-testid="profile-language-select" id="language" className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem data-testid="profile-language-option-en" value="en" lang="en">English</SelectItem><SelectItem data-testid="profile-language-option-tr" value="tr" lang="tr">Türkçe</SelectItem></SelectContent>
        </Select>
      </section>
      <form onSubmit={submit} className="max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-soft">
        <div className="space-y-2">
          <Label htmlFor="full_name">{t("profile.fullName")}</Label>
          <Input data-testid="profile-full-name-input" id="full_name" name="full_name" defaultValue={profile.full_name} required className="h-12 rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">{t("profile.phone")}</Label>
          <Input data-testid="profile-phone-input" id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} className="h-12 rounded-xl" />
        </div>
        <dl className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">{t("profile.email")}</dt><dd data-testid="profile-email" className="font-medium break-all">{profile.email}</dd></div>
          <div><dt className="text-muted-foreground">{t("profile.role")}</dt><dd data-testid="profile-role" className="font-medium">{t(`common.roles.${primaryRole(roles)}`)}</dd></div>
          <div><dt className="text-muted-foreground">{t("profile.branch")}</dt><dd data-testid="profile-branch" className="font-medium">{profile.branches?.name ?? "—"}</dd></div>
        </dl>
        {!isDirector && <p className="text-xs text-muted-foreground">{t(roles.includes("branch_manager") ? "profile.roleNoteBranchManager" : "profile.roleNote")}</p>}
        <Button data-testid="profile-save-button" type="submit" className="h-12 rounded-xl px-6" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
      </form>
      <PrivacyPreferences />
      <section aria-labelledby="delete-h" className="max-w-xl space-y-3 rounded-2xl border bg-card p-6 shadow-soft">
        <h2 id="delete-h" className="text-xl font-semibold">{t("profile.deleteTitle")}</h2>
        {isDirector ? (
          <p data-testid="profile-director-delete-note" className="text-sm text-muted-foreground">{t("profile.directorNote")}</p>
        ) : myRequest.isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : myRequest.data ? (
          <>
            <p data-testid="profile-deletion-pending-notice" className="text-sm">{t("profile.requestedOn", { date: formatDate(myRequest.data.requested_at) })}</p>
            <Button variant="outline" className="h-11 rounded-xl" disabled={deleteBusy} data-testid="profile-cancel-deletion-button" onClick={() => runDeletion("cancel")}>{deleteBusy ? t("profile.cancelling") : t("profile.cancelRequest")}</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("profile.deleteIntro")}</p>
            <Button variant="destructive" className="h-11 rounded-xl" data-testid="profile-delete-account-button" onClick={() => setConfirmOpen(true)}>{t("profile.deleteTitle")}</Button>
          </>
        )}
      </section>
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!deleteBusy) setConfirmOpen(o); }}>
        <DialogContent data-testid="profile-delete-confirm-dialog" className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("profile.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("profile.confirmText")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button data-testid="confirm-dialog-cancel-button" variant="outline" disabled={deleteBusy} onClick={() => setConfirmOpen(false)}>{t("profile.keepAccount")}</Button>
            <Button data-testid="confirm-dialog-confirm-button" variant="destructive" disabled={deleteBusy} onClick={() => runDeletion("request")}>{deleteBusy ? t("profile.sending") : t("profile.requestDeletion")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
