import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Check, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { formatDate, translateError } from "@/lib/i18n";
import { fetchMembers, fetchPendingDeletionRequests, setStatus, type DeletionRequest } from "@/lib/members";
import { deletionDaysRemaining } from "@/lib/member-rules";
import { DeleteUserDialog } from "@/components/app/DeleteUserDialog";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_app/approvals")({
  head: () => pageHead("Approvals", "Approve new volunteers and process account deletion requests."),
  component: Approvals,
});

function Approvals() {
  const { session, isManager } = useAuth();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const uid = session!.user.id;
  const { data, isLoading } = useQuery({ queryKey: ["members", uid], queryFn: () => fetchMembers(uid), enabled: isManager });
  const requests = useQuery({ queryKey: ["deletion-requests", uid], queryFn: () => fetchPendingDeletionRequests(uid), enabled: isManager });
  const [processing, setProcessing] = useState<DeletionRequest | null>(null);
  if (!isManager) return <Navigate to="/dashboard" replace />;
  const pending = (data ?? []).filter((m) => m.status === "pending");
  const reqs = requests.data ?? [];

  async function act(id: string, status: "active" | "inactive") {
    try {
      await setStatus(id, status);
      toast.success(status === "active" ? t("approvals.approved") : t("approvals.rejected"));
      qc.invalidateQueries({ queryKey: ["members"] });
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{t("approvals.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("approvals.intro")}</p>
      </div>
      <Tabs defaultValue="signups">
        <TabsList>
          <TabsTrigger data-testid="approvals-tab-new" value="signups">{t("approvals.newVolunteers")}{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
          <TabsTrigger data-testid="approvals-tab-deletions" value="deletions">{t("approvals.deletionRequests")}{reqs.length ? ` (${reqs.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="signups" className="mt-4">
          {isLoading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : pending.length === 0 ? (
            <div data-testid="approvals-empty-state" className="rounded-2xl border bg-card p-10 text-center text-muted-foreground shadow-soft">{t("approvals.allCaughtUp")}</div>
          ) : (
            <ul className="space-y-3">
              {pending.map((m) => (
                <li key={m.id} data-testid="approvals-row" data-user-id={m.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p data-testid="approvals-row-name" className="font-semibold">{m.full_name || t("common.unnamed")}</p>
                    <p className="text-sm text-muted-foreground break-all">{m.email} · {m.phone}</p>
                    <p className="text-sm text-muted-foreground">{m.branches?.name} · {t("approvals.signedUp", { date: formatDate(m.created_at) })}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button data-testid="approvals-approve-button" className="h-11 rounded-xl" onClick={() => act(m.id, "active")}><Check className="mr-1 h-4 w-4" /> {t("approvals.approve")}</Button>
                    <Button data-testid="approvals-reject-button" variant="outline" className="h-11 rounded-xl" onClick={() => act(m.id, "inactive")}><X className="mr-1 h-4 w-4" /> {t("approvals.reject")}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="deletions" className="mt-4">
          {requests.isLoading ? <p className="text-muted-foreground">{t("common.loading")}</p> : requests.isError ? <div data-testid="deletion-requests-error" role="alert"><p className="text-destructive">{t("approvals.requestsError")}</p><Button variant="outline" onClick={() => requests.refetch()}>{t("common.retry")}</Button></div> : reqs.length === 0 ? (
            <div data-testid="deletion-requests-empty-state" className="rounded-2xl border bg-card p-10 text-center text-muted-foreground shadow-soft">{t("approvals.noRequests")}</div>
          ) : (
            <ul className="space-y-3">
              {reqs.map((r) => {
                const days = deletionDaysRemaining(r.requested_at);
                return <li key={r.id} data-testid="deletion-request-row" data-request-id={r.id} data-user-id={r.user_id} className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    {r.user_id ? <Link data-testid="deletion-request-user-link" to="/users/$id" params={{ id: r.user_id }} className="font-semibold underline-offset-4 hover:underline">{r.profiles?.full_name || t("common.unnamed")}</Link> : <p className="font-semibold">{t("common.formerMember")}</p>}
                    <p className="text-sm text-muted-foreground break-all">{r.profiles?.email} · {r.profiles?.branches?.name ?? t("common.noBranch")}</p>
                    <p className="text-sm text-muted-foreground">{t("approvals.requested", { date: formatDate(r.requested_at) })} · <span data-testid="deletion-request-days-left" className={days <= 5 ? "font-semibold text-destructive" : ""}>{t("approvals.daysRemaining", { count: days })}</span></p>
                  </div>
                  <Button data-testid="deletion-request-process-button" variant="destructive" className="h-11 rounded-xl" disabled={!r.user_id} onClick={() => setProcessing(r)}><Trash2 className="mr-1 h-4 w-4" /> {t("approvals.processDeletion")}</Button>
                </li>;
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <DeleteUserDialog target={processing?.user_id ? { id: processing.user_id, fullName: processing.profiles?.full_name ?? "", requestId: processing.id } : null} onClose={() => setProcessing(null)} onDeleted={() => { setProcessing(null); qc.invalidateQueries({ queryKey: ["deletion-requests"] }); qc.invalidateQueries({ queryKey: ["members"] }); }} />
    </div>
  );
}
