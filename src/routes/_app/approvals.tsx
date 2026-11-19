import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchMembers, setStatus } from "@/lib/members";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/approvals")({
  head: () => pageHead("Approvals", "Approve new volunteers for your branch."),
  component: Approvals,
});

function Approvals() {
  const { session, isManager } = useAuth();
  const qc = useQueryClient();
  const uid = session!.user.id;
  const { data, isLoading } = useQuery({ queryKey: ["members", uid], queryFn: () => fetchMembers(uid), enabled: isManager });
  if (!isManager) return <Navigate to="/dashboard" replace />;
  const pending = (data ?? []).filter((m) => m.status === "pending");

  async function act(id: string, status: "active" | "inactive") {
    try {
      await setStatus(id, status);
      toast.success(status === "active" ? "Volunteer approved" : "Request rejected");
      qc.invalidateQueries({ queryKey: ["members"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Approvals</h1>
        <p className="mt-1 text-muted-foreground">New volunteers waiting to join.</p>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground shadow-soft">No one is waiting for approval. All caught up!</div>
      ) : (
        <ul className="space-y-3">
          {pending.map((m) => (
            <li key={m.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{m.full_name || "Unnamed"}</p>
                <p className="text-sm text-muted-foreground break-all">{m.email} · {m.phone}</p>
                <p className="text-sm text-muted-foreground">{m.branches?.name} · signed up {new Date(m.created_at).toLocaleDateString("en-GB")}</p>
              </div>
              <div className="flex gap-2">
                <Button className="h-11 rounded-xl" onClick={() => act(m.id, "active")}><Check className="mr-1 h-4 w-4" /> Approve</Button>
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => act(m.id, "inactive")}><X className="mr-1 h-4 w-4" /> Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
