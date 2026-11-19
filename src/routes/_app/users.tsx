import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { useAuth, primaryRole } from "@/lib/auth";
import { useTranslation } from "react-i18next";
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

const STATUSES = ["pending", "active", "inactive"] as const;

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="h-11"><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
}

function UsersPage() {
  const { session, profile, roles, isManager } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
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
  const roleOptions = [{ value: "volunteer", label: t("common.roles.volunteer") }, { value: "branch_manager", label: t("common.roles.branch_manager") }];

  return <div className="space-y-6">
    <h1 className="text-3xl font-semibold">{t("users.title")}</h1>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden /><Input aria-label={t("users.search")} placeholder={t("users.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-9" /></div>
      <Choice label={t("users.filterStatus")} value={status} onChange={setStatusFilter} options={[{ value: "all", label: t("users.allStatuses") }, ...STATUSES.map((value) => ({ value, label: t(`common.status.${value}`) }))]} />
      <Choice label={t("users.filterRole")} value={role} onChange={setRoleFilter} options={[{ value: "all", label: t("users.allRoles") }, ...roleOptions]} />
      {director && <Choice label={t("users.filterBranch")} value={branch} onChange={setBranchFilter} options={[{ value: "all", label: t("users.allBranches") }, ...branchOptions]} />}
    </div>
    {director && branches.isError && <p role="alert" className="text-destructive">{t("users.branchesError")} <Button variant="link" onClick={() => branches.refetch()}>{t("common.retry")}</Button></p>}
    {members.isLoading ? <p className="text-muted-foreground">{t("common.loading")}</p> : members.isError ? <div role="alert"><p className="text-destructive">{t("users.loadError")}</p><Button variant="outline" onClick={() => members.refetch()}>{t("common.retry")}</Button></div> : !filtered.length ? <p className="border-y py-10 text-center text-muted-foreground">{all.length ? t("users.noMatch") : t("users.empty")}</p> : <ul className="divide-y border-y">
      {filtered.map((m) => <li key={m.id} role="link" tabIndex={0} aria-label={t("users.viewDetailsFor", { name: m.full_name || t("common.unnamed") })} onClick={(e) => { if (e.target instanceof Element && e.target.closest("a")) return; navigate({ to: "/users/$id", params: { id: m.id } }); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); navigate({ to: "/users/$id", params: { id: m.id } }); } }} className="flex cursor-pointer flex-col gap-4 px-3 py-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><Link to="/users/$id" params={{ id: m.id }} className="font-semibold break-words underline-offset-4 hover:underline">{m.full_name || t("common.unnamed")}</Link><p className="text-sm text-muted-foreground break-all">{m.email}</p><p className="text-sm text-muted-foreground">{m.branches?.name ?? t("common.noBranch")}</p></div>
          <div className="flex flex-wrap gap-2"><Badge variant="outline">{t(`common.roles.${primaryRole(m.roles)}`)}</Badge><Badge variant={m.status === "active" ? "default" : "secondary"}>{t(`common.status.${m.status}`)}</Badge></div>
        </div>
        <Button asChild variant="outline" className="h-11 shrink-0 self-start sm:self-auto"><Link to="/users/$id" params={{ id: m.id }} aria-label={t("users.viewDetailsFor", { name: m.full_name || t("common.unnamed") })}>{t("users.viewDetails")}<ChevronRight className="ml-2 h-4 w-4" aria-hidden /></Link></Button>
      </li>)}
    </ul>}
  </div>;
}
