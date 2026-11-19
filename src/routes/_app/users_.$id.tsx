import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ArrowRightLeft, Check, History, Sparkles, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useAuth, primaryRole, ROLE_LABELS } from "@/lib/auth";
import { fetchMember, fetchDirectorBranches, setStatus, setRole, setBranch } from "@/lib/members";
import { canEditRoleOrBranch, deleteBlockReason } from "@/lib/member-rules";
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

const STATUS_LABEL = { pending: "Pending", active: "Active", inactive: "Inactive" } as const;

function UserDetails() {
  const { id } = Route.useParams();
  const { session, profile, roles, isManager } = useAuth();
  const uid = session?.user.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const director = canEditRoleOrBranch(profile?.status, roles);
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
  if (id === uid || (member.isSuccess && !member.data)) return <div className="space-y-4"><h1 className="text-3xl font-semibold">Not allowed</h1><p className="text-muted-foreground">You don't have permission to view this user.</p><Button asChild variant="outline"><Link to="/users"><ArrowLeft className="mr-2 h-4 w-4" />Back to users</Link></Button></div>;
  if (member.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (member.isError || !member.data) return <div role="alert"><p className="text-destructive">This user could not be loaded.</p><Button variant="outline" onClick={() => member.refetch()}>Retry</Button></div>;
  const m = member.data;
  const block = deleteBlockReason(m.status);
  const branchOptions = (branches.data ?? []).map((b) => ({ value: b.id, label: b.name }));
  const roleOptions = [{ value: "volunteer", label: "Volunteer" }, { value: "branch_manager", label: "Branch Manager" }];

  async function refresh() {
    await Promise.all([qc.invalidateQueries({ queryKey: ["member", id] }), qc.invalidateQueries({ queryKey: ["members"] }), qc.invalidateQueries({ queryKey: ["member-history"] })]);
  }
  async function changeStatus(next: "active" | "inactive", msg: string) {
    setBusy(true);
    try { await setStatus(m.id, next); toast.success(msg); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Status could not be changed"); }
    finally { setBusy(false); }
  }
  async function confirmEdit() {
    if (!edit || !value) return;
    setBusy(true); setError("");
    try {
      if (edit === "role") { if (value !== "volunteer" && value !== "branch_manager") return; await setRole(m.id, value); }
      else await setBranch(m.id, value);
      toast.success(edit === "role" ? "Role changed" : "Branch changed"); setEdit(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Change could not be saved"); }
    finally { setBusy(false); }
  }

  const rows: [string, string][] = [
    ["Name", m.full_name || "Unnamed"], ["Email", m.email ?? "—"], ["Phone", m.phone || "—"],
    ["Branch", m.branches?.name ?? "No branch"], ["Region", m.branches?.regions?.name ?? "—"],
    ["Role", ROLE_LABELS[primaryRole(m.roles)]], ["Status", STATUS_LABEL[m.status]],
    ["Joined", new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(new Date(m.created_at))],
  ];

  return <div className="space-y-8">
    <div className="space-y-3">
      <Link to="/users" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />Users</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold break-words">{m.full_name || "Unnamed"}</h1><Badge variant="outline">{ROLE_LABELS[primaryRole(m.roles)]}</Badge><Badge variant={m.status === "active" ? "default" : "secondary"}>{STATUS_LABEL[m.status]}</Badge></div>
    </div>

    <section aria-labelledby="profile-h" className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 id="profile-h" className="text-xl font-semibold">Profile</h2>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{rows.map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium break-words">{v}</dd></div>)}</dl>
    </section>

    <section aria-labelledby="actions-h" className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 id="actions-h" className="text-xl font-semibold">Actions</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {m.status === "pending" && <Button className="h-11" disabled={busy} onClick={() => changeStatus("active", "Volunteer approved")}><Check className="mr-2 h-4 w-4" />Approve</Button>}
        {m.status === "active" && <Button variant="outline" className="h-11" disabled={busy} onClick={() => changeStatus("inactive", "User deactivated")}>Deactivate</Button>}
        {m.status === "inactive" && <Button variant="outline" className="h-11" disabled={busy} onClick={() => changeStatus("active", "User activated")}>Activate</Button>}
        {director && <><Button variant="outline" className="h-11" onClick={() => { setEdit("role"); setValue(primaryRole(m.roles)); setError(""); }}><UserCog className="mr-2 h-4 w-4" />Change role</Button>
          <Button variant="outline" className="h-11" disabled={!branches.data?.length} onClick={() => { setEdit("branch"); setValue(m.branch_id ?? ""); setError(""); }}><ArrowRightLeft className="mr-2 h-4 w-4" />Move to another branch</Button></>}
        <div className="flex flex-col gap-1">
          <Button variant="destructive" className="h-11" disabled={!!block} aria-describedby={block ? "delete-hint" : undefined} onClick={() => setDeleting(true)}><Trash2 className="mr-2 h-4 w-4" />Delete user</Button>
          {block && <p id="delete-hint" className="text-xs text-muted-foreground">{block}</p>}
        </div>
      </div>
    </section>

    <section aria-labelledby="history-h" className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 id="history-h" className="text-xl font-semibold">History</h2>
      <p className="mt-1 text-sm text-muted-foreground">Every change to this user's status, role and branch.</p>
      <Button variant="outline" className="mt-4 h-11" onClick={() => setHistoryOpen(true)}><History className="mr-2 h-4 w-4" />View history</Button>
    </section>

    <div className="grid gap-4 md:grid-cols-3">{["Tasks", "Events", "Training"].map((t) => <section key={t} className="rounded-2xl border bg-card p-6 shadow-soft"><h2 className="text-xl font-semibold">{t}</h2><p className="mt-2 flex items-center gap-2 text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" aria-hidden />Coming soon</p></section>)}</div>

    <Dialog open={!!edit && director} onOpenChange={(open) => { if (!open && !busy) setEdit(null); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader><DialogTitle>{edit === "role" ? "Change role" : "Move to another branch"}</DialogTitle><DialogDescription>Confirm the change for {m.full_name || "this user"}.</DialogDescription></DialogHeader>
        <Label>{edit === "role" ? "New role" : "New branch"}</Label>
        <Select value={value} onValueChange={setValue}><SelectTrigger aria-label={edit === "role" ? "New role" : "New branch"} className="h-11"><SelectValue /></SelectTrigger><SelectContent>{(edit === "role" ? roleOptions : branchOptions).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button variant="outline" disabled={busy} onClick={() => setEdit(null)}>Cancel</Button><Button disabled={busy || !value || (edit === "role" ? value === primaryRole(m.roles) : value === m.branch_id)} onClick={confirmEdit}>{busy ? "Saving…" : "Confirm change"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <MemberHistory member={historyOpen ? m : null} onClose={() => setHistoryOpen(false)} />
    <DeleteUserDialog target={deleting ? { id: m.id, fullName: m.full_name } : null} onClose={() => setDeleting(false)} onDeleted={async () => { setDeleting(false); qc.removeQueries({ queryKey: ["member", id] }); await qc.invalidateQueries({ queryKey: ["members"] }); navigate({ to: "/users", replace: true }); }} />
  </div>;
}
