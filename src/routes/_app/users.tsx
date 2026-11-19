import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { useAuth, primaryRole, ROLE_LABELS } from "@/lib/auth";
import { fetchMembers, fetchDirectorBranches } from "@/lib/members";
import { filterMembers, canEditRoleOrBranch } from "@/lib/member-rules";
import { pageHead } from "@/components/app/head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const navigate = useNavigate();
  const uid = session?.user.id ?? "";
  const director = canEditRoleOrBranch(profile?.status, roles);
  const members = useQuery({ queryKey: ["members", uid], queryFn: () => fetchMembers(uid), enabled: !!uid && isManager });
  const branches = useQuery({ queryKey: ["director-branches", uid, director, profile?.branch_id], queryFn: () => fetchDirectorBranches(uid), enabled: !!uid && director });
  const [search, setSearch] = useState("");
  const [status, setStatusFilter] = useState("all");
  const [role, setRoleFilter] = useState("all");
  const [branch, setBranchFilter] = useState("all");
  if (!isManager) return <Navigate to="/dashboard" replace />;

  const all = members.data ?? [];
  const filtered = filterMembers(all, { search, status, role, branch: director ? branch : "all" });
  const branchOptions = (branches.data ?? []).map((b) => ({ value: b.id, label: b.name }));
  const roleOptions = [{ value: "volunteer", label: "Volunteer" }, { value: "branch_manager", label: "Branch Manager" }];

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
      {filtered.map((m) => <li key={m.id} role="link" tabIndex={0} aria-label={`View details for ${m.full_name || "Unnamed"}`} onClick={(e) => { if (e.target instanceof Element && e.target.closest("a")) return; navigate({ to: "/users/$id", params: { id: m.id } }); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); navigate({ to: "/users/$id", params: { id: m.id } }); } }} className="flex cursor-pointer flex-col gap-4 px-3 py-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><Link to="/users/$id" params={{ id: m.id }} className="font-semibold break-words underline-offset-4 hover:underline">{m.full_name || "Unnamed"}</Link><p className="text-sm text-muted-foreground break-all">{m.email}</p><p className="text-sm text-muted-foreground">{m.branches?.name ?? "No branch"}</p></div>
          <div className="flex flex-wrap gap-2"><Badge variant="outline">{ROLE_LABELS[primaryRole(m.roles)]}</Badge><Badge variant={m.status === "active" ? "default" : "secondary"}>{STATUS_LABEL[m.status]}</Badge></div>
        </div>
        <Button asChild variant="outline" className="h-11 shrink-0 self-start sm:self-auto"><Link to="/users/$id" params={{ id: m.id }} aria-label={`View details for ${m.full_name || "Unnamed"}`}>View details<ChevronRight className="ml-2 h-4 w-4" aria-hidden /></Link></Button>
      </li>)}
    </ul>}
  </div>;
}
