import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth, primaryRole, ROLE_LABELS } from "@/lib/auth";
import { fetchMembers, setStatus } from "@/lib/members";
import { pageHead } from "@/components/app/head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/users")({
  head: () => pageHead("Users", "Volunteers in your branch or region."),
  component: UsersPage,
});

const STATUS_LABEL = { pending: "Pending", active: "Active", inactive: "Inactive" } as const;

function UsersPage() {
  const { session, isManager } = useAuth();
  const qc = useQueryClient();
  const uid = session!.user.id;
  const { data, isLoading } = useQuery({ queryKey: ["members", uid], queryFn: () => fetchMembers(uid), enabled: isManager });
  if (!isManager) return <Navigate to="/dashboard" replace />;

  async function toggle(id: string, status: "active" | "inactive") {
    try {
      await setStatus(id, status);
      toast.success(status === "active" ? "User activated" : "User deactivated");
      qc.invalidateQueries({ queryKey: ["members"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Users</h1>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (data ?? []).length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground shadow-soft">No users yet.</div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-soft">
          {data!.map((m) => (
            <li key={m.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{m.full_name || "Unnamed"}</p>
                <p className="text-sm text-muted-foreground break-all">{m.email}</p>
                <p className="text-sm text-muted-foreground">{ROLE_LABELS[primaryRole(m.roles)]} · {m.branches?.name ?? "No branch"}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={m.status === "active" ? "default" : "secondary"}>{STATUS_LABEL[m.status]}</Badge>
                {m.status === "active" ? (
                  <Button variant="outline" className="h-11 rounded-xl" onClick={() => toggle(m.id, "inactive")}>Deactivate</Button>
                ) : (
                  <Button className="h-11 rounded-xl" onClick={() => toggle(m.id, "active")}>Activate</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
