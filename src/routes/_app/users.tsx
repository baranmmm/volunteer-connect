import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { History, ArrowRightLeft, UserCog, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth, primaryRole, ROLE_LABELS } from "@/lib/auth";
import { fetchMembers, fetchDirectorBranches, setStatus, setRole, setBranch, type Member } from "@/lib/members";
import { filterMembers, canEditRoleOrBranch, isLastBranchManager } from "@/lib/member-rules";
import { MemberHistory } from "@/components/app/MemberHistory";
import { pageHead } from "@/components/app/head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/users")({
  head: () => pageHead("Users", "Manage volunteer roles, branches, approvals and member history."),
  component: UsersPage,
});

const STATUS_LABEL = { pending: "Pending", active: "Active", inactive: "Inactive" } as const;

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="h-11"><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
}

function UsersPage() {
  const { session, profile, roles, isManager } = useAuth();
  const qc = useQueryClient();
  const uid = session?.user.id ?? "";
  const director = canEditRoleOrBranch(profile?.status, roles);
  const members = useQuery({ queryKey: ["members", uid], queryFn: () => fetchMembers(uid), enabled: !!uid && isManager });
  const branches = useQuery({ queryKey: ["director-branches", uid, director, profile?.branch_id], queryFn: () => fetchDirectorBranches(uid), enabled: !!uid && director });
  const [search, setSearch] = useState("");
  const [status, setStatusFilter] = useState("all");
  const [role, setRoleFilter] = useState("all");
  const [branch, setBranchFilter] = useState("all");
  const [history, setHistory] = useState<Member | null>(null);
  const [edit, setEdit] = useState<{ kind: "role" | "branch"; member: Member } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!isManager) return <Navigate to="/dashboard" replace />;

  const all = members.data ?? [];
  const filtered = filterMembers(all, { search, status, role, branch: director ? branch : "all" });
  const branchOptions = (branches.data ?? []).map((b) => ({ value: b.id, label: b.name }));
  const roleOptions = [{ value: "volunteer", label: "Volunteer" }, { value: "branch_manager", label: "Branch Manager" }];
  const warning = edit?.kind === "role" && value === "volunteer" && isLastBranchManager(edit.member, all);

  async function invalidate() {
    await Promise.all([qc.invalidateQueries({ queryKey: ["members"] }), qc.invalidateQueries({ queryKey: ["member-history"] })]);
  }
  async function toggle(id: string, next: "active" | "inactive") {
    setPendingStatus(id);
    try { await setStatus(id, next); toast.success(next === "active" ? "User activated" : "User deactivated"); await invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Status could not be changed"); }
    finally { setPendingStatus(null); }
  }
  function openEdit(kind: "role" | "branch", member: Member) {
    setEdit({ kind, member }); setValue(kind === "role" ? primaryRole(member.roles) : member.branch_id ?? ""); setError("");
  }
  async function confirm() {
    if (!edit || !director || !value) return;
    setBusy(true); setError("");
    try {
      if (edit.kind === "role") {
        if (value !== "volunteer" && value !== "branch_manager") return;
        await setRole(edit.member.id, value);
      } else { await setBranch(edit.member.id, value); }
      toast.success(edit.kind === "role" ? "Role changed" : "Branch changed"); setEdit(null); await invalidate();
    } catch (e) { setError(e instanceof Error ? e.message : "Change could not be saved"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <h1 className="text-3xl font-semibold">Users</h1>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden /><Input aria-label="Search name or email" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-9" /></div>
      <Choice label="Filter by status" value={status} onChange={setStatusFilter} options={[{ value: "all", label: "All statuses" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
      <Choice label="Filter by role" value={role} onChange={setRoleFilter} options={[{ value: "all", label: "All roles" }, ...roleOptions]} />
      {director && <Choice label="Filter by branch" value={branch} onChange={setBranchFilter} options={[{ value: "all", label: "All branches" }, ...branchOptions]} />}
    </div>
    {director && branches.isError && <p role="alert" className="text-destructive">Branches could not be loaded. <Button variant="link" onClick={() => branches.refetch()}>Retry</Button></p>}
    {members.isLoading ? <p className="text-muted-foreground">Loading…</p> : members.isError ? <div role="alert"><p className="text-destructive">Users could not be loaded.</p><Button variant="outline" onClick={() => members.refetch()}>Retry</Button></div> : !filtered.length ? <p className="border-y py-10 text-center text-muted-foreground">{all.length ? "No users match these filters." : "No users yet."}</p> : <ul className="divide-y border-y">
      {filtered.map((m) => <li key={m.id} className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><p className="font-semibold break-words">{m.full_name || "Unnamed"}</p><p className="text-sm text-muted-foreground break-all">{m.email}</p><p className="text-sm text-muted-foreground">{m.branches?.name ?? "No branch"}</p></div>
          <div className="flex flex-wrap gap-2"><Badge variant="outline">{ROLE_LABELS[primaryRole(m.roles)]}</Badge><Badge variant={m.status === "active" ? "default" : "secondary"}>{STATUS_LABEL[m.status]}</Badge></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" disabled={pendingStatus !== null} onClick={() => toggle(m.id, m.status === "active" ? "inactive" : "active")}>{pendingStatus === m.id ? "Saving…" : m.status === "active" ? "Deactivate" : "Activate"}</Button>
          {director && <><Button variant="outline" className="h-11" onClick={() => openEdit("role", m)}><UserCog className="mr-2 h-4 w-4" />Change role</Button><Button variant="outline" className="h-11" disabled={!branches.data?.length} onClick={() => openEdit("branch", m)}><ArrowRightLeft className="mr-2 h-4 w-4" />Move to another branch</Button></>}
          <Button variant="ghost" className="h-11" onClick={() => setHistory(m)}><History className="mr-2 h-4 w-4" />History</Button>
        </div>
      </li>)}
    </ul>}
    <Dialog open={!!edit && director} onOpenChange={(open) => { if (!open && !busy) setEdit(null); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader><DialogTitle>{edit?.kind === "role" ? "Change role" : "Move to another branch"}</DialogTitle><DialogDescription>Confirm the change for {edit?.member.full_name || "this user"}.</DialogDescription></DialogHeader>
        <Label>{edit?.kind === "role" ? "New role" : "New branch"}</Label>
        <Choice label={edit?.kind === "role" ? "New role" : "New branch"} value={value} onChange={setValue} options={edit?.kind === "role" ? roleOptions : branchOptions} />
        {warning && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">This is the last Branch Manager in {edit?.member.branches?.name ?? "this branch"}. Continuing will leave the branch without a Branch Manager.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button variant="outline" disabled={busy} onClick={() => setEdit(null)}>Cancel</Button><Button disabled={busy || !value || (edit?.kind === "role" ? value === primaryRole(edit.member.roles) : value === edit?.member.branch_id)} onClick={confirm}>{busy ? "Saving…" : "Confirm change"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <MemberHistory member={history} onClose={() => setHistory(null)} />
  </div>;
}
