import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ArrowRightLeft, Check, History, Sparkles, Trash2, UserCog, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth, primaryRole } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { formatDate, translateError } from "@/lib/i18n";
import { fetchMember, fetchMembers, fetchDirectorBranches, setStatus, setRole, setBranch } from "@/lib/members";
import { canEditRoleOrBranch, deleteBlockReason, isLastBranchManager } from "@/lib/member-rules";
import { MemberHistory } from "@/components/app/MemberHistory";
import { DeleteUserDialog } from "@/components/app/DeleteUserDialog";
import { pageHead } from "@/components/app/head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/users_/$id")({
  head: () => pageHead("User details", "View a volunteer's profile, history and available actions."),
  component: UserDetails,
});

function UserDetails() {
  const { id } = Route.useParams();
  const { session, profile, roles, isManager } = useAuth();
  const uid = session?.user.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const director = canEditRoleOrBranch(profile?.status, roles);
  const members = useQuery({ queryKey: ["members", uid], queryFn: () => fetchMembers(uid), enabled: !!uid && director });
  // RLS only returns this profile when can_manage_user(auth.uid(), id) is true.
  const member = useQuery({ queryKey: ["member", id], queryFn: () => fetchMember(id), enabled: isManager && id !== uid });
  const branches = useQuery({ queryKey: ["director-branches", uid, director, profile?.branch_id], queryFn: () => fetchDirectorBranches(uid), enabled: !!uid && director });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [edit, setEdit] = useState<"role" | "branch" | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!isManager) return <Navigate to="/dashboard" replace />;
  if (id === uid || (member.isSuccess && !member.data)) return <div className="space-y-4"><h1 className="text-3xl font-semibold">{t("userDetails.notAllowedTitle")}</h1><p className="text-muted-foreground">{t("userDetails.notAllowedText")}</p><Button asChild variant="outline"><Link to="/users"><ArrowLeft className="mr-2 h-4 w-4" />{t("userDetails.back")}</Link></Button></div>;
  if (member.isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (member.isError || !member.data) return <div role="alert"><p className="text-destructive">{t("userDetails.loadError")}</p><Button variant="outline" onClick={() => member.refetch()}>{t("common.retry")}</Button></div>;
  const m = member.data;
  const block = deleteBlockReason(m.status);
  const branchOptions = (branches.data ?? []).map((b) => ({ value: b.id, label: b.name }));
  const roleOptions = [{ value: "volunteer", label: t("common.roles.volunteer") }, { value: "branch_manager", label: t("common.roles.branch_manager") }];

  async function refresh() {
    await Promise.all([qc.invalidateQueries({ queryKey: ["member", id] }), qc.invalidateQueries({ queryKey: ["members"] }), qc.invalidateQueries({ queryKey: ["member-history"] })]);
  }
  async function changeStatus(next: "active" | "inactive", msg: string) {
    setBusy(true);
    try { await setStatus(m.id, next); toast.success(msg); await refresh(); }
    catch (e) { toast.error(translateError(e)); }
    finally { setBusy(false); }
  }
  async function confirmEdit() {
    if (!edit || !value) return;
    setBusy(true); setError("");
    try {
      if (edit === "role") { if (value !== "volunteer" && value !== "branch_manager") return; await setRole(m.id, value); }
      else await setBranch(m.id, value);
      toast.success(edit === "role" ? t("userDetails.roleChanged") : t("userDetails.branchChanged")); setEdit(null); await refresh();
    } catch (e) { setError(translateError(e)); }
    finally { setBusy(false); }
  }

  const rows: [string, string][] = [
    [t("userDetails.name"), m.full_name || t("common.unnamed")], [t("userDetails.email"), m.email ?? "—"], [t("userDetails.phone"), m.phone || "—"],
    [t("userDetails.branch"), m.branches?.name ?? t("common.noBranch")], [t("userDetails.region"), m.branches?.regions?.name ?? "—"],
    [t("userDetails.role"), t(`common.roles.${primaryRole(m.roles)}`)], [t("userDetails.status"), t(`common.status.${m.status}`)],
    [t("userDetails.joined"), formatDate(m.created_at)],
  ];

  return <div className="space-y-8">
    <div className="space-y-3">
      <Link to="/users" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />{t("userDetails.usersLink")}</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold break-words">{m.full_name || t("common.unnamed")}</h1><Badge variant="outline">{t(`common.roles.${primaryRole(m.roles)}`)}</Badge><Badge variant={m.status === "active" ? "default" : "secondary"}>{t(`common.status.${m.status}`)}</Badge></div>
    </div>

    <section aria-labelledby="profile-h" className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 id="profile-h" className="text-xl font-semibold">{t("userDetails.profile")}</h2>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{rows.map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium break-words">{v}</dd></div>)}</dl>
    </section>

    <section aria-labelledby="actions-h" className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 id="actions-h" className="text-xl font-semibold">{t("userDetails.actions")}</h2>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        {m.status === "pending" && <>
          <Button className="h-11" disabled={busy} onClick={() => changeStatus("active", t("userDetails.approved"))}><Check className="mr-2 h-4 w-4" />{t("userDetails.approve")}</Button>
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => changeStatus("inactive", t("userDetails.rejected"))}><X className="mr-2 h-4 w-4" />{t("userDetails.reject")}</Button>
        </>}
        <Button variant="outline" className="h-11" onClick={() => setHistoryOpen(true)}><History className="mr-2 h-4 w-4" />{t("userDetails.history")}</Button>
        {director && <><Button variant="outline" className="h-11" onClick={() => { setEdit("role"); setValue(primaryRole(m.roles)); setError(""); }}><UserCog className="mr-2 h-4 w-4" />{t("userDetails.changeRole")}</Button>
          {!!branches.data?.length && <Button variant="outline" className="h-11" onClick={() => { setEdit("branch"); setValue(m.branch_id ?? ""); setError(""); }}><ArrowRightLeft className="mr-2 h-4 w-4" />{t("userDetails.moveBranch")}</Button>}</>}
        <div className="flex flex-col gap-2 border-t pt-3 sm:ml-2 sm:flex-row sm:items-start sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          {m.status === "active" && <Button variant="outline" className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => changeStatus("inactive", t("userDetails.deactivated"))}>{t("userDetails.deactivate")}</Button>}
          {m.status === "inactive" && <Button variant="outline" className="h-11" disabled={busy} onClick={() => changeStatus("active", t("userDetails.reactivated"))}>{t("userDetails.reactivate")}</Button>}
          <div className="flex flex-col gap-1">
            <Button variant="destructive" className="h-11" disabled={!!block} aria-describedby={block ? "delete-hint" : undefined} onClick={() => setDeleting(true)}><Trash2 className="mr-2 h-4 w-4" />{t("userDetails.deleteUser")}</Button>
            {block && <p id="delete-hint" className="text-xs text-muted-foreground">{t("userDetails.deactivateFirst")}</p>}
          </div>
        </div>
      </div>
    </section>

    <div className="grid gap-4 md:grid-cols-3">{(["tasks", "events", "training"] as const).map((k) => <section key={k} className="rounded-2xl border bg-card p-6 shadow-soft"><h2 className="text-xl font-semibold">{t(`userDetails.${k}`)}</h2><p className="mt-2 flex items-center gap-2 text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" aria-hidden />{t("common.comingSoon")}</p></section>)}</div>

    <Dialog open={!!edit && director} onOpenChange={(open) => { if (!open && !busy) setEdit(null); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader><DialogTitle>{edit === "role" ? t("userDetails.changeRole") : t("userDetails.moveBranch")}</DialogTitle><DialogDescription>{t("userDetails.confirmFor", { name: m.full_name || t("userDetails.thisUser") })}</DialogDescription></DialogHeader>
        <Label>{edit === "role" ? t("userDetails.newRole") : t("userDetails.newBranch")}</Label>
        <Select value={value} onValueChange={setValue}><SelectTrigger aria-label={edit === "role" ? t("userDetails.newRole") : t("userDetails.newBranch")} className="h-11"><SelectValue /></SelectTrigger><SelectContent>{(edit === "role" ? roleOptions : branchOptions).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
        {edit === "role" && value === "volunteer" && isLastBranchManager(m, members.data ?? []) && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{t("userDetails.lastManager", { branch: m.branches?.name ?? t("userDetails.thisBranch") })}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button variant="outline" disabled={busy} onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button disabled={busy || !value || (edit === "role" ? value === primaryRole(m.roles) : value === m.branch_id)} onClick={confirmEdit}>{busy ? t("common.saving") : t("userDetails.confirmChange")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <MemberHistory member={historyOpen ? m : null} onClose={() => setHistoryOpen(false)} />
    <DeleteUserDialog target={deleting ? { id: m.id, fullName: m.full_name } : null} onClose={() => setDeleting(false)} onDeleted={async () => { setDeleting(false); qc.removeQueries({ queryKey: ["member", id] }); await qc.invalidateQueries({ queryKey: ["members"] }); navigate({ to: "/users", replace: true }); }} />
  </div>;
}
