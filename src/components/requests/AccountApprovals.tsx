// The former Approvals page, now part of Requests → "Waiting for my approval" (Branch Managers and Regional
// Directors): volunteers whose account waits for approval, and account deletion requests to process. RLS decides
// which rows come back (the caller's branch or region); each section is hidden while it has nothing to show.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Trash2, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { useAuth } from "@/lib/auth";
import { formatDate, translateError } from "@/lib/i18n";
import {
  fetchPendingDeletionRequests,
  fetchPendingMembers,
  setStatus,
  type DeletionRequest,
} from "@/lib/members";
import { deletionDaysRemaining } from "@/lib/member-rules";
import { DeleteUserDialog } from "@/components/app/DeleteUserDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Pending sign-ups and deletion requests of the signed-in manager (the same queries the sections show). */
export function useAccountApprovals() {
  const { session, isManager } = useAuth();
  const uid = session?.user.id ?? "";
  const pending = useQuery({
    queryKey: ["members", "pending", uid],
    queryFn: () => fetchPendingMembers(uid),
    enabled: isManager && !!uid,
  });
  const deletions = useQuery({
    queryKey: ["deletion-requests", uid],
    queryFn: () => fetchPendingDeletionRequests(uid),
    enabled: isManager && !!uid,
  });
  return {
    pending,
    deletions,
    /** Known once both have loaded (or failed): the page waits for it to choose its first tab. */
    settled: !isManager || (!pending.isPending && !deletions.isPending),
    count: isManager ? (pending.data?.length ?? 0) + (deletions.data?.length ?? 0) : 0,
  };
}

function SectionTitle({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-xl font-semibold">
      {title}
      <Badge variant="secondary">{count}</Badge>
    </h2>
  );
}

/** Volunteers whose account waits for approval: approve or reject. */
export function PendingVolunteers() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const { pending } = useAccountApprovals();
  const rows = pending.data ?? [];
  if (!isManager || !rows.length) return null;
  async function act(id: string, status: "active" | "inactive") {
    try {
      await setStatus(id, status);
      toast.success(status === "active" ? t("approvals.approved") : t("approvals.rejected"));
      void qc.invalidateQueries({ queryKey: ["members"] });
    } catch (e) {
      toast.error(translateError(e));
    }
  }
  return (
    <section
      data-testid="approvals-new-volunteers"
      aria-labelledby="approvals-new-h"
      className="space-y-3"
    >
      <SectionTitle id="approvals-new-h" title={t("approvals.newVolunteers")} count={rows.length} />
      <ul className="space-y-3">
        {rows.map((m) => (
          <li
            key={m.id}
            data-testid="approvals-row"
            data-user-id={m.id}
            className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p data-testid="approvals-row-name" className="font-semibold">
                {m.full_name || t("common.unnamed")}
              </p>
              <p className="break-all text-sm text-muted-foreground">
                {m.email} · {m.phone}
              </p>
              <p className="text-sm text-muted-foreground">
                {m.branches?.name} · {t("approvals.signedUp", { date: formatDate(m.created_at) })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="approvals-approve-button"
                className="h-11 rounded-xl"
                onClick={() => void act(m.id, "active")}
              >
                <Check className="mr-1 h-4 w-4" /> {t("approvals.approve")}
              </Button>
              <Button
                data-testid="approvals-reject-button"
                variant="outline"
                className="h-11 rounded-xl"
                onClick={() => void act(m.id, "inactive")}
              >
                <X className="mr-1 h-4 w-4" /> {t("approvals.reject")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Account deletion requests of the people the manager looks after: process (erase) through the delete dialog. */
export function DeletionRequests() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const { deletions } = useAccountApprovals();
  const [processing, setProcessing] = useState<DeletionRequest | null>(null);
  const rows = deletions.data ?? [];
  if (!isManager) return null;
  if (deletions.isError)
    return (
      <div data-testid="deletion-requests-error" role="alert" className="space-y-2">
        <p className="text-destructive">{t("approvals.requestsError")}</p>
        <Button variant="outline" onClick={() => void deletions.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  if (!rows.length) return null;
  return (
    <section
      data-testid="approvals-deletion-requests"
      aria-labelledby="approvals-deletions-h"
      className="space-y-3"
    >
      <SectionTitle
        id="approvals-deletions-h"
        title={t("approvals.deletionRequests")}
        count={rows.length}
      />
      <ul className="space-y-3">
        {rows.map((r) => {
          const days = deletionDaysRemaining(r.requested_at);
          return (
            <li
              key={r.id}
              data-testid="deletion-request-row"
              data-request-id={r.id}
              data-user-id={r.user_id}
              className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                {r.user_id ? (
                  <Link
                    data-testid="deletion-request-user-link"
                    to="/users/$id"
                    params={{ id: r.user_id }}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {r.profiles?.full_name || t("common.unnamed")}
                  </Link>
                ) : (
                  <p className="font-semibold">{t("common.formerMember")}</p>
                )}
                <p className="break-all text-sm text-muted-foreground">
                  {r.profiles?.email} · {r.profiles?.branches?.name ?? t("common.noBranch")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("approvals.requested", { date: formatDate(r.requested_at) })} ·{" "}
                  <span
                    data-testid="deletion-request-days-left"
                    className={days <= 5 ? "font-semibold text-destructive" : ""}
                  >
                    {t("approvals.daysRemaining", { count: days })}
                  </span>
                </p>
              </div>
              <Button
                data-testid="deletion-request-process-button"
                variant="destructive"
                className="h-11 rounded-xl"
                disabled={!r.user_id}
                onClick={() => setProcessing(r)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> {t("approvals.processDeletion")}
              </Button>
            </li>
          );
        })}
      </ul>
      <DeleteUserDialog
        target={
          processing?.user_id
            ? {
                id: processing.user_id,
                fullName: processing.profiles?.full_name ?? "",
                requestId: processing.id,
              }
            : null
        }
        onClose={() => setProcessing(null)}
        onDeleted={() => {
          setProcessing(null);
          void qc.invalidateQueries({ queryKey: ["deletion-requests"] });
          void qc.invalidateQueries({ queryKey: ["members"] });
        }}
      />
    </section>
  );
}
