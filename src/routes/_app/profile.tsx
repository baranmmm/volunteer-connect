import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { primaryRole, isFollowerRoles, isNationalCoordinator } from "@/lib/roles";
import { FollowedBranches } from "@/components/app/FollowedBranches";
import { MfaSetup, useMfaStatus } from "@/components/app/MfaGate";
import { useTranslation } from "react-i18next";
import { formatDate, isLang, setLanguage, translateError, type Lang } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { PrivacyPreferences } from "@/components/app/PrivacyPreferences";
import {
  AccountDeletionDialog,
  FollowerDeleteDialog,
  useAccountDeletion,
} from "@/components/app/AccountDeletion";

export const Route = createFileRoute("/_app/profile")({
  head: () => pageHead("Profile", "Manage your volunteer profile."),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, roles, refresh, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const { t, i18n } = useTranslation();
  // Regional Directors and National Coordinators cannot be deleted in the app; followers delete their account directly.
  const isDirector = roles.includes("regional_director") || isNationalCoordinator(roles);
  const follower = isFollowerRoles(roles),
    nc = isNationalCoordinator(roles);
  const [followerDeleting, setFollowerDeleting] = useState(false);
  const mfa = useMfaStatus(nc, session?.user.id);
  const deletion = useAccountDeletion(profile?.id, !isDirector && !follower);
  const { myRequest, setConfirmOpen, busy: deleteBusy, run: runDeletion } = deletion;
  if (!profile) return null;

  async function changeLanguage(value: string) {
    if (!isLang(value)) return;
    const previous = i18n.language as Lang;
    setLanguage(value as Lang);
    const { error } = await supabase
      .from("profiles")
      .update({ preferred_language: value })
      .eq("id", profile!.id);
    if (error) {
      setLanguage(previous);
      toast.error(translateError(error));
      return;
    }
    toast.success(i18n.t("profile.languageSaved", { lng: value }));
    refresh();
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: String(f.get("full_name")).trim(),
        phone: String(f.get("phone")).trim(),
      })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) {
      toast.error(translateError(error));
      return;
    }
    toast.success(t("profile.saved"));
    refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("profile.title")}</h1>
      <section className="max-w-xl space-y-2 rounded-2xl border bg-card p-6 shadow-soft">
        <Label htmlFor="language">{t("profile.language")}</Label>
        <Select value={i18n.language} onValueChange={changeLanguage}>
          <SelectTrigger
            data-testid="profile-language-select"
            id="language"
            className="h-12 rounded-xl"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem data-testid="profile-language-option-en" value="en" lang="en">
              English
            </SelectItem>
            <SelectItem data-testid="profile-language-option-tr" value="tr" lang="tr">
              Türkçe
            </SelectItem>
          </SelectContent>
        </Select>
      </section>
      <form
        onSubmit={submit}
        className="max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-soft"
      >
        <div className="space-y-2">
          <Label htmlFor="full_name">{t("profile.fullName")}</Label>
          <Input
            data-testid="profile-full-name-input"
            id="full_name"
            name="full_name"
            defaultValue={profile.full_name}
            required
            className="h-12 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">{t("profile.phone")}</Label>
          <Input
            data-testid="profile-phone-input"
            id="phone"
            name="phone"
            type="tel"
            defaultValue={profile.phone ?? ""}
            className="h-12 rounded-xl"
          />
        </div>
        <dl className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("profile.email")}</dt>
            <dd data-testid="profile-email" className="font-medium break-all">
              {profile.email}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("profile.role")}</dt>
            <dd data-testid="profile-role" className="font-medium">
              {t(`common.roles.${primaryRole(roles)}`)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("profile.branch")}</dt>
            <dd data-testid="profile-branch" className="font-medium">
              {profile.branches?.name ?? "—"}
            </dd>
          </div>
        </dl>
        {!isDirector && (
          <p className="text-xs text-muted-foreground">
            {t(
              roles.includes("branch_manager")
                ? "profile.roleNoteBranchManager"
                : "profile.roleNote",
            )}
          </p>
        )}
        <Button
          data-testid="profile-save-button"
          type="submit"
          className="h-12 rounded-xl px-6"
          disabled={busy}
        >
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </form>
      <FollowedBranches />
      {nc && (
        <section
          data-testid="profile-mfa"
          aria-labelledby="mfa-h"
          className="max-w-xl space-y-3 rounded-2xl border bg-card p-6 shadow-soft"
        >
          <h2 id="mfa-h" className="text-xl font-semibold">
            {t("mfa.title")}
          </h2>
          {mfa.data?.factorId ? (
            <p data-testid="profile-mfa-on" className="text-sm">
              {t("mfa.on")}
            </p>
          ) : (
            <MfaSetup onDone={() => void mfa.refetch()} />
          )}
        </section>
      )}
      <PrivacyPreferences />
      <section
        aria-labelledby="delete-h"
        className="max-w-xl space-y-3 rounded-2xl border bg-card p-6 shadow-soft"
      >
        <h2 id="delete-h" className="text-xl font-semibold">
          {t("profile.deleteTitle")}
        </h2>
        {isDirector ? (
          <p data-testid="profile-director-delete-note" className="text-sm text-muted-foreground">
            {t(nc ? "profile.coordinatorNote" : "profile.directorNote")}
          </p>
        ) : follower ? (
          <>
            <p className="text-sm text-muted-foreground">{t("profile.followerDeleteIntro")}</p>
            <Button
              variant="destructive"
              className="h-11 rounded-xl"
              data-testid="profile-delete-account-button"
              onClick={() => setFollowerDeleting(true)}
            >
              {t("profile.deleteTitle")}
            </Button>
          </>
        ) : myRequest.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : myRequest.data ? (
          <>
            <p data-testid="profile-deletion-pending-notice" className="text-sm">
              {t("profile.requestedOn", { date: formatDate(myRequest.data.requested_at) })}
            </p>
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              disabled={deleteBusy}
              data-testid="profile-cancel-deletion-button"
              onClick={() => void runDeletion("cancel")}
            >
              {deleteBusy ? t("profile.cancelling") : t("profile.cancelRequest")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("profile.deleteIntro")}</p>
            <Button
              variant="destructive"
              className="h-11 rounded-xl"
              data-testid="profile-delete-account-button"
              onClick={() => setConfirmOpen(true)}
            >
              {t("profile.deleteTitle")}
            </Button>
          </>
        )}
      </section>
      <AccountDeletionDialog deletion={deletion} />
      <FollowerDeleteDialog open={followerDeleting} onClose={() => setFollowerDeleting(false)} />
    </div>
  );
}
