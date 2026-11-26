import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  History,
  Sparkles,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useAuth } from "@/lib/auth";
import { primaryRole, isNationalCoordinator } from "@/lib/roles";
import { useTranslation } from "react-i18next";
import { formatDate, translateError } from "@/lib/i18n";
import {
  fetchMember,
  fetchMembers,
  fetchDirectorBranches,
  fetchAllBranchesAndRegions,
  setStatus,
  setRole,
  setBranch,
} from "@/lib/members";
import { canEditRoleOrBranch, deleteBlockReason, isLastBranchManager } from "@/lib/member-rules";
import { MemberHistory } from "@/components/app/MemberHistory";
import { DeleteUserDialog } from "@/components/app/DeleteUserDialog";
import { pageHead } from "@/components/app/head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/users_/$id")({
  head: () =>
    pageHead("User details", "View a volunteer's profile, history and available actions."),
  component: UserDetails,
});

function UserDetails() {
  const { id } = Route.useParams();
  const { session, profile, roles, isManager } = useAuth();
  const uid = session?.user.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // National Coordinators manage Regional Directors and Branch Managers anywhere (the database allows nothing else).
  const nc = isNationalCoordinator(roles);
  const director = canEditRoleOrBranch(profile?.status, roles) || nc;
  const manager = isManager || nc;
  // Branch Managers switch a member of their branch between Volunteer and Trustee (set_user_role checks it again).
  const branchManager =
    !director && profile?.status === "active" && roles.includes("branch_manager");
  const members = useQuery({
    queryKey: ["members", uid],
    queryFn: () => fetchMembers(uid),
    enabled: !!uid && director,
  });
  // RLS only returns this profile when can_manage_user(auth.uid(), id) is true.
  const member = useQuery({
    queryKey: ["member", id],
    queryFn: () => fetchMember(id),
    enabled: manager && id !== uid,
  });
  const branches = useQuery({
    queryKey: ["director-branches", uid, director, profile?.branch_id],
    queryFn: async () =>
      nc ? (await fetchAllBranchesAndRegions()).branches : fetchDirectorBranches(uid),
    enabled: !!uid && director,
  });
  const regions = useQuery({
    queryKey: ["all-regions", uid],
    queryFn: async () => (await fetchAllBranchesAndRegions()).regions,
    enabled: !!uid && nc,
  });
  const [regionValue, setRegionValue] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [edit, setEdit] = useState<"role" | "branch" | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!manager) return <Navigate to="/dashboard" replace />;
  if (id === uid || (member.isSuccess && !member.data))
    return (
      <div data-testid="user-details-not-allowed" className="space-y-4">
        <h1 className="text-3xl font-bold">{t("userDetails.notAllowedTitle")}</h1>
        <p className="text-muted-foreground">{t("userDetails.notAllowedText")}</p>
        <Button asChild variant="outline">
          <Link data-testid="user-details-back-link" to="/users">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("userDetails.back")}
          </Link>
        </Button>
      </div>
    );
  if (member.isLoading)
    return (
      <p data-testid="user-details-loading" className="text-muted-foreground">
        {t("common.loading")}
      </p>
    );
  if (member.isError || !member.data)
    return (
      <div data-testid="user-details-load-error" role="alert">
        <p className="text-destructive">{t("userDetails.loadError")}</p>
        <Button variant="outline" onClick={() => member.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  const m = member.data;
  const block = deleteBlockReason(m.status);
  const branchOptions = (branches.data ?? []).map((b) => ({ value: b.id, label: b.name }));
  const targetRole = primaryRole(m.roles);
  const switchable = targetRole === "volunteer" || targetRole === "trustee";
  const canChangeRole = director || (branchManager && switchable);
  const roleOptions = [
    { value: "volunteer", label: t("common.roles.volunteer") },
    { value: "trustee", label: t("common.roles.trustee") },
    ...(director ? [{ value: "branch_manager", label: t("common.roles.branch_manager") }] : []),
    ...(nc ? [{ value: "regional_director", label: t("common.roles.regional_director") }] : []),
  ];

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["member", id] }),
      qc.invalidateQueries({ queryKey: ["members"] }),
      qc.invalidateQueries({ queryKey: ["member-history"] }),
    ]);
  }
  async function changeStatus(next: "active" | "inactive", msg: string) {
    setBusy(true);
    try {
      await setStatus(m.id, next);
      toast.success(msg);
      await refresh();
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmEdit() {
    if (!edit || !value) return;
    setBusy(true);
    setError("");
    try {
      if (edit === "role") {
        if (
          value !== "volunteer" &&
          value !== "trustee" &&
          value !== "branch_manager" &&
          value !== "regional_director"
        )
          return;
        await setRole(
          m.id,
          value,
          value === "regional_director" ? regionValue || undefined : undefined,
        );
      } else await setBranch(m.id, value);
      toast.success(
        edit === "role" ? t("userDetails.roleChanged") : t("userDetails.branchChanged"),
      );
      setEdit(null);
      await refresh();
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string, string?][] = [
    [t("userDetails.name"), m.full_name || t("common.unnamed"), "user-details-name"],
    [t("userDetails.email"), m.email ?? "—", "user-details-email"],
    [t("userDetails.phone"), m.phone || "—", "user-details-phone"],
    [t("userDetails.branch"), m.branches?.name ?? t("common.noBranch"), "user-details-branch"],
    [t("userDetails.region"), m.branches?.regions?.name ?? "—", "user-details-region"],
    [t("userDetails.role"), t(`common.roles.${primaryRole(m.roles)}`), "user-details-role"],
    [t("userDetails.status"), t(`common.status.${m.status}`), "user-details-status"],
    [t("userDetails.joined"), formatDate(m.created_at)],
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          data-testid="user-details-back-link"
          to="/users"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("userDetails.usersLink")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold break-words">{m.full_name || t("common.unnamed")}</h1>
          <Badge variant="outline">{t(`common.roles.${primaryRole(m.roles)}`)}</Badge>
          <Badge variant={m.status === "active" ? "default" : "secondary"}>
            {t(`common.status.${m.status}`)}
          </Badge>
        </div>
      </div>

      <section aria-labelledby="profile-h" className="rounded-2xl border bg-card p-6 shadow-soft">
        <h2 id="profile-h" className="text-xl font-semibold">
          {t("userDetails.profile")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {rows.map(([k, v, testId]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd data-testid={testId} className="font-medium [overflow-wrap:anywhere]">
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="actions-h" className="rounded-2xl border bg-card p-6 shadow-soft">
        <h2 id="actions-h" className="text-xl font-semibold">
          {t("userDetails.actions")}
        </h2>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
          {m.status === "pending" && (
            <>
              <Button
                data-testid="user-details-approve-button"
                className="h-11"
                disabled={busy}
                onClick={() => changeStatus("active", t("userDetails.approved"))}
              >
                <Check className="mr-2 h-4 w-4" />
                {t("userDetails.approve")}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={busy}
                data-testid="user-details-reject-button"
                onClick={() => changeStatus("inactive", t("userDetails.rejected"))}
              >
                <X className="mr-2 h-4 w-4" />
                {t("userDetails.reject")}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            className="h-11"
            data-testid="user-details-history-button"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-2 h-4 w-4" />
            {t("userDetails.history")}
          </Button>
          {canChangeRole && (
            <Button
              variant="outline"
              className="h-11"
              data-testid="user-details-change-role-button"
              onClick={() => {
                setEdit("role");
                setValue(primaryRole(m.roles));
                setError("");
              }}
            >
              <UserCog className="mr-2 h-4 w-4" />
              {t("userDetails.changeRole")}
            </Button>
          )}
          {director && (
            <>
              {!!branches.data?.length && (
                <Button
                  variant="outline"
                  className="h-11"
                  data-testid="user-details-move-branch-button"
                  onClick={() => {
                    setEdit("branch");
                    setValue(m.branch_id ?? "");
                    setError("");
                  }}
                >
                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                  {t("userDetails.moveBranch")}
                </Button>
              )}
            </>
          )}
          <div className="flex flex-col gap-2 border-t pt-3 sm:ml-2 sm:flex-row sm:items-start sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            {m.status === "active" && (
              <Button
                variant="outline"
                className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                data-testid="user-details-deactivate-button"
                onClick={() => changeStatus("inactive", t("userDetails.deactivated"))}
              >
                {t("userDetails.deactivate")}
              </Button>
            )}
            {m.status === "inactive" && (
              <Button
                variant="outline"
                className="h-11"
                disabled={busy}
                data-testid="user-details-reactivate-button"
                onClick={() => changeStatus("active", t("userDetails.reactivated"))}
              >
                {t("userDetails.reactivate")}
              </Button>
            )}
            <div className="flex flex-col gap-1">
              <Button
                variant="destructive"
                className="h-11"
                disabled={!!block}
                aria-describedby={block ? "delete-hint" : undefined}
                data-testid="user-details-delete-button"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("userDetails.deleteUser")}
              </Button>
              {block && (
                <p
                  data-testid="user-details-delete-hint"
                  id="delete-hint"
                  className="text-xs text-muted-foreground"
                >
                  {t("userDetails.deactivateFirst")}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {(["tasks", "events", "training"] as const).map((k) => (
          <section key={k} className="rounded-2xl border bg-card p-6 shadow-soft">
            <h2 className="text-xl font-semibold">{t(`userDetails.${k}`)}</h2>
            <p className="mt-2 flex items-center gap-2 text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              {t("common.comingSoon")}
            </p>
          </section>
        ))}
      </div>

      <Dialog
        open={!!edit && (director || (edit === "role" && canChangeRole))}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(null);
        }}
      >
        <DialogContent
          data-testid={edit === "role" ? "change-role-dialog" : "move-branch-dialog"}
          className="max-w-[calc(100%-2rem)] sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>
              {edit === "role" ? t("userDetails.changeRole") : t("userDetails.moveBranch")}
            </DialogTitle>
            <DialogDescription>
              {t("userDetails.confirmFor", { name: m.full_name || t("userDetails.thisUser") })}
            </DialogDescription>
          </DialogHeader>
          <Label>{edit === "role" ? t("userDetails.newRole") : t("userDetails.newBranch")}</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger
              data-testid={edit === "role" ? "change-role-select" : "move-branch-select"}
              aria-label={edit === "role" ? t("userDetails.newRole") : t("userDetails.newBranch")}
              className="h-11"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(edit === "role" ? roleOptions : branchOptions).map((o) => (
                <SelectItem
                  key={o.value}
                  value={o.value}
                  data-testid={
                    edit === "role"
                      ? `change-role-option-${o.value}`
                      : `move-branch-option-${o.value}`
                  }
                >
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {edit === "role" && value === "trustee" && (
            <p data-testid="change-role-trustee-hint" className="text-sm text-muted-foreground">
              {t("common.trusteeHint")}
            </p>
          )}
          {edit === "role" &&
            (value === "volunteer" || value === "trustee") &&
            isLastBranchManager(m, members.data ?? []) && (
              <p
                data-testid="last-manager-warning"
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                {t("userDetails.lastManager", {
                  branch: m.branches?.name ?? t("userDetails.thisBranch"),
                })}
              </p>
            )}
          {edit === "role" && value === "regional_director" && (
            <>
              <Label>{t("userDetails.newRegion")}</Label>
              <Select value={regionValue} onValueChange={setRegionValue}>
                <SelectTrigger
                  data-testid="change-role-region-select"
                  aria-label={t("userDetails.newRegion")}
                  className="h-11"
                >
                  <SelectValue placeholder={t("userDetails.chooseRegion")} />
                </SelectTrigger>
                <SelectContent>
                  {(regions.data ?? []).map((r) => (
                    <SelectItem
                      key={r.id}
                      value={r.id}
                      data-testid={`change-role-region-option-${r.id}`}
                    >
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {error && (
            <p data-testid="edit-dialog-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              data-testid="confirm-dialog-cancel-button"
              variant="outline"
              disabled={busy}
              onClick={() => setEdit(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="confirm-dialog-confirm-button"
              disabled={
                busy ||
                !value ||
                (edit === "role"
                  ? (value === primaryRole(m.roles) && value !== "regional_director") ||
                    (value === "regional_director" && !regionValue)
                  : value === m.branch_id)
              }
              onClick={confirmEdit}
            >
              {busy ? t("common.saving") : t("userDetails.confirmChange")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MemberHistory member={historyOpen ? m : null} onClose={() => setHistoryOpen(false)} />
      <DeleteUserDialog
        target={deleting ? { id: m.id, fullName: m.full_name } : null}
        onClose={() => setDeleting(false)}
        onDeleted={async () => {
          setDeleting(false);
          qc.removeQueries({ queryKey: ["member", id] });
          await qc.invalidateQueries({ queryKey: ["members"] });
          navigate({ to: "/users", replace: true });
        }}
      />
    </div>
  );
}
