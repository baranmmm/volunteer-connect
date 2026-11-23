import { useState, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  Ban,
  CalendarClock,
  Check,
  CircleCheck,
  Clock,
  ExternalLink,
  ListChecks,
  Undo2,
  Users2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { eventWhen } from "@/lib/event-rules";
import { dateLocale, formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  DECLINE_NOTE_MIN,
  isOpenWorkRequest,
  workRequestTitle,
  type MeetingRequest,
  type WorkRequest,
} from "@/lib/work-requests";
import {
  acceptTaskRequest,
  approveMeetingRequest,
  declineWorkRequest,
  listMyWorkRequests,
  listWorkRequestsToReview,
  withdrawWorkRequest,
} from "@/lib/work-requests.functions";
import { useWorkMember, WORK_REQUEST_KEYS } from "@/lib/use-work-notices";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventDialog } from "@/components/events/EventDialog";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import type { RequestListFilter } from "./request-kinds";

const taskHref = (id: string) => `/tasks?task=${id}`;
const meetingHref = (id: string) => `/meetings/${id}`;

/** An in-app link to a stored path (with its query string), opened by the router. */
export function InAppLink({
  href,
  testId,
  className,
  onNavigate,
  children,
}: {
  href: string;
  testId?: string;
  className?: string;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  function open(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    onNavigate?.();
    void navigate({ href });
  }
  return (
    <a href={href} data-testid={testId} onClick={open} className={className}>
      {children}
    </a>
  );
}

const LINK =
  "inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline";

const STATUS_STYLE: Record<WorkRequest["status"], string> = {
  submitted: "border-dashed border-status-draft-border bg-status-draft-bg text-status-draft",
  accepted: "border-status-published bg-status-published-bg text-status-published",
  approved: "border-status-published bg-status-published-bg text-status-published",
  declined: "border-status-cancelled bg-status-cancelled-bg text-status-cancelled",
  withdrawn: "border-border bg-muted text-muted-foreground",
};
const STATUS_ICON = {
  submitted: Clock,
  accepted: CircleCheck,
  approved: CircleCheck,
  declined: Ban,
  withdrawn: Undo2,
} as const;

/** Written status label with icon (never colour alone), same tokens as event requests. */
export function WorkRequestStatusBadge({
  status,
  testId,
}: {
  status: WorkRequest["status"];
  testId?: string;
}) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[status];
  return (
    <Badge
      data-testid={testId}
      data-status={status}
      variant="outline"
      className={cn("gap-1", STATUS_STYLE[status])}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`workRequests.status.${status}`)}
    </Badge>
  );
}

function KindBadge({ kind }: { kind: WorkRequest["kind"] }) {
  const { t } = useTranslation();
  const Icon = kind === "task" ? ListChecks : Users2;
  return (
    <Badge variant="secondary" className="gap-1">
      <Icon className="size-3.5" aria-hidden />
      {t(`requests.kinds.${kind}`)}
    </Badge>
  );
}

/** Task: description, priority, due date. Meeting: note and proposed times (London time). */
function WorkRequestDetails({ request }: { request: WorkRequest }) {
  const { t } = useTranslation();
  if (request.kind === "task")
    return (
      <>
        {request.description && (
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {request.description}
          </p>
        )}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span data-testid="work-request-priority" data-priority={request.priority}>
            {t("workRequests.priorityLabel", {
              priority: t(`workRequests.priorities.${request.priority}`),
            })}
          </span>
          {request.due_date && (
            <span data-testid="work-request-due">
              {t("workRequests.dueOn", {
                date: formatDate(`${request.due_date}T12:00:00Z`, { dateStyle: "medium" }),
              })}
            </span>
          )}
        </p>
      </>
    );
  return (
    <>
      {request.note && (
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{request.note}</p>
      )}
      {request.proposed_times.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">{t("workRequests.proposedTimes")}</p>
          <ul className="mt-1 space-y-1">
            {request.proposed_times.map((time, i) => (
              <li
                key={`${time.starts_at}-${i}`}
                data-testid="work-request-proposed-time"
                className="flex items-start gap-2 text-muted-foreground"
              >
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {
                    eventWhen({ start_at: time.starts_at, end_at: time.ends_at }, dateLocale())
                      ?.text
                  }
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("workRequests.noProposedTimes")}</p>
      )}
    </>
  );
}

function ResultLink({ request, prefix }: { request: WorkRequest; prefix: string }) {
  const { t } = useTranslation();
  if (request.kind === "task" && request.status === "accepted" && request.task_id)
    return (
      <InAppLink href={taskHref(request.task_id)} testId={`${prefix}-open-task`} className={LINK}>
        {t("workRequests.openTask")}
        <ExternalLink className="size-3.5" aria-hidden />
      </InAppLink>
    );
  if (request.kind === "meeting" && request.status === "approved" && request.meeting_id)
    return (
      <InAppLink
        href={meetingHref(request.meeting_id)}
        testId={`${prefix}-open-meeting`}
        className={LINK}
      >
        {t("workRequests.openMeeting")}
        <ExternalLink className="size-3.5" aria-hidden />
      </InAppLink>
    );
  return null;
}

function LoadError({ onRetry, testId }: { onRetry: () => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" data-testid={testId} className="space-y-2">
      <p className="text-destructive">{t("workRequests.loadError")}</p>
      <Button variant="outline" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

/** The signed-in member's task and meeting requests, narrowed by the page's all/open/decided filter. */
export function MyWorkRequests({
  filter = "all",
  showEmpty = false,
}: {
  filter?: RequestListFilter;
  showEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const qc = useQueryClient();
  const fetch = useServerFn(listMyWorkRequests),
    withdraw = useServerFn(withdrawWorkRequest);
  const query = useQuery({
    queryKey: ["my-work-requests", session?.user.id],
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 30000,
  });
  const [confirm, setConfirm] = useState<WorkRequest | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      await withdraw({ data: { id: confirm.id, kind: confirm.kind } });
      await Promise.all(WORK_REQUEST_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(t("requests.withdrawnToast"));
      setConfirm(null);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  if (!member) return null;
  if (query.isError)
    return <LoadError testId="work-requests-error" onRetry={() => void query.refetch()} />;
  const rows = (query.data ?? []).filter(
    (r) => filter === "all" || (filter === "open") === isOpenWorkRequest(r),
  );
  if (!rows.length)
    return showEmpty && !query.isLoading ? (
      <p
        data-testid="work-requests-empty"
        className="border-y py-10 text-center text-muted-foreground"
      >
        {t("workRequests.emptyMine")}
      </p>
    ) : null;
  return (
    <section aria-labelledby="my-work-requests-h" className="space-y-3">
      <h2 id="my-work-requests-h" className="text-lg font-semibold">
        {t("workRequests.mineTitle")}
      </h2>
      <ul data-testid="work-requests-list" className="space-y-3">
        {rows.map((r) => (
          <li
            key={`${r.kind}-${r.id}`}
            data-testid="work-request-row"
            data-request-id={r.id}
            data-kind={r.kind}
            data-status={r.status}
            className="min-w-0 space-y-2 rounded-lg border bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                {workRequestTitle(r)}
              </h3>
              <span className="flex flex-wrap gap-2">
                <KindBadge kind={r.kind} />
                <WorkRequestStatusBadge status={r.status} testId="work-request-status" />
              </span>
            </div>
            <p className="text-sm [overflow-wrap:anywhere]">
              {t("workRequests.sentTo", { name: r.target_name ?? t("common.formerMember") })}
            </p>
            <WorkRequestDetails request={r} />
            <p className="text-xs text-muted-foreground">
              {t("requests.submittedOn", {
                date: formatDate(r.created_at, { dateStyle: "medium" }),
              })}
            </p>
            {r.status === "declined" && r.decline_reason && (
              <p
                data-testid="work-request-decline-note"
                className="whitespace-pre-wrap rounded-md bg-status-cancelled-bg p-2 text-sm [overflow-wrap:anywhere]"
              >
                {t("requests.declinedBecause", { reason: r.decline_reason })}
              </p>
            )}
            <ResultLink request={r} prefix="work-request" />
            {r.status === "submitted" && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="work-request-withdraw"
                  onClick={() => {
                    setError("");
                    setConfirm(r);
                  }}
                >
                  <Undo2 />
                  {t("requests.withdraw")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <EventDialog
        open={confirm !== null}
        onClose={() => !busy && setConfirm(null)}
        title={t("requests.withdrawTitle")}
      >
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {t("workRequests.withdrawText", { title: confirm ? workRequestTitle(confirm) : "" })}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="work-request-withdraw-confirm"
            variant="destructive"
            disabled={busy}
            onClick={() => void act()}
          >
            {busy ? t("common.saving") : t("requests.withdrawConfirm")}
          </Button>
        </div>
      </EventDialog>
    </section>
  );
}

/** Task and meeting requests sent to the signed-in person: open ones (with Accept/Approve/Decline) or decided ones. */
export function ReviewWorkRequests({
  filter,
  showEmpty = false,
}: {
  filter: "open" | "decided";
  showEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const member = useWorkMember();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetch = useServerFn(listWorkRequestsToReview),
    accept = useServerFn(acceptTaskRequest),
    approve = useServerFn(approveMeetingRequest),
    decline = useServerFn(declineWorkRequest);
  const query = useQuery({
    queryKey: ["work-requests-review", filter, session?.user.id],
    queryFn: () => fetch({ data: { filter } }),
    enabled: member,
    staleTime: 30000,
  });
  const [declining, setDeclining] = useState<string | null>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<{ id: string; message: string } | null>(null),
    [approving, setApproving] = useState<MeetingRequest | null>(null);
  const refresh = () =>
    Promise.all(
      [...WORK_REQUEST_KEYS, "tasks", "task-summary"].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setError({ id, message: translateError(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function acceptTask(r: WorkRequest) {
    let task = "";
    const ok = await run(r.id, async () => {
      task = await accept({ data: { id: r.id } });
    });
    if (ok)
      toast.success(t("workRequests.acceptedToast"), {
        action: {
          label: t("workRequests.openTask"),
          onClick: () => void navigate({ href: taskHref(task) }),
        },
      });
  }
  async function confirmDecline(r: WorkRequest) {
    const ok = await run(r.id, () =>
      decline({ data: { id: r.id, kind: r.kind, reason: note.trim() } }),
    );
    if (ok) {
      toast.success(t("requests.declinedToast"));
      setDeclining(null);
      setNote("");
    }
  }
  if (!member) return null;
  if (query.isError)
    return <LoadError testId="work-review-load-error" onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  const first = approving?.proposed_times[0];
  return (
    <section aria-labelledby={`work-review-${filter}-h`} className="space-y-3">
      {(rows.length > 0 || showEmpty) && (
        <h2 id={`work-review-${filter}-h`} className="text-lg font-semibold">
          {t(filter === "open" ? "workRequests.reviewTitle" : "workRequests.decidedTitle")}
        </h2>
      )}
      {!rows.length && showEmpty && !query.isLoading && (
        <p
          data-testid="work-review-empty"
          className="border-y py-10 text-center text-muted-foreground"
        >
          {t(filter === "open" ? "workRequests.emptyReview" : "workRequests.emptyDecided")}
        </p>
      )}
      {rows.length > 0 && (
        <ul data-testid={`work-review-list-${filter}`} className="space-y-3">
          {rows.map((r) => {
            const open = r.status === "submitted";
            const isDeclining = declining === r.id;
            const rowBusy = busy === r.id;
            return (
              <li
                key={`${r.kind}-${r.id}`}
                data-testid="work-review-row"
                data-request-id={r.id}
                data-kind={r.kind}
                data-status={r.status}
                className="min-w-0 space-y-2 rounded-lg border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                    {workRequestTitle(r)}
                  </h3>
                  <span className="flex flex-wrap gap-2">
                    <KindBadge kind={r.kind} />
                    <WorkRequestStatusBadge status={r.status} testId="work-review-status" />
                  </span>
                </div>
                <p data-testid="work-review-requester" className="text-sm [overflow-wrap:anywhere]">
                  {t("requests.requestedBy", {
                    name: r.requester_name ?? t("common.formerMember"),
                  })}
                </p>
                <WorkRequestDetails request={r} />
                <p className="text-xs text-muted-foreground">
                  {t("requests.submittedOn", {
                    date: formatDate(r.created_at, { dateStyle: "medium" }),
                  })}
                </p>
                {r.status === "declined" && r.decline_reason && (
                  <p className="whitespace-pre-wrap rounded-md bg-status-cancelled-bg p-2 text-sm [overflow-wrap:anywhere]">
                    {t("requests.declinedBecause", { reason: r.decline_reason })}
                  </p>
                )}
                <ResultLink request={r} prefix="work-review" />
                {open && isDeclining && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`work-review-decline-note-${r.id}`}>
                      {t("requests.declineReason")} *
                    </Label>
                    <Textarea
                      id={`work-review-decline-note-${r.id}`}
                      data-testid="work-review-decline-note"
                      value={note}
                      maxLength={1000}
                      rows={3}
                      disabled={rowBusy}
                      aria-describedby={`work-review-decline-hint-${r.id}`}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <p
                      id={`work-review-decline-hint-${r.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t("workRequests.declineHint", { count: DECLINE_NOTE_MIN })}
                    </p>
                  </div>
                )}
                {error?.id === r.id && (
                  <p
                    data-testid="work-review-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {error.message}
                  </p>
                )}
                {open && (
                  <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:justify-end">
                    {isDeclining ? (
                      <>
                        <Button
                          variant="outline"
                          data-testid="work-review-decline-cancel"
                          disabled={rowBusy}
                          onClick={() => {
                            setDeclining(null);
                            setError(null);
                          }}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          variant="destructive"
                          data-testid="work-review-decline-confirm"
                          disabled={rowBusy || note.trim().length < DECLINE_NOTE_MIN}
                          onClick={() => void confirmDecline(r)}
                        >
                          <Ban />
                          {t("requests.declineConfirm")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          data-testid="work-review-decline"
                          className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busy !== null}
                          onClick={() => {
                            setDeclining(r.id);
                            setNote("");
                            setError(null);
                          }}
                        >
                          <Ban />
                          {t("requests.decline")}
                        </Button>
                        {r.kind === "task" ? (
                          <Button
                            data-testid="work-review-accept"
                            disabled={busy !== null}
                            onClick={() => void acceptTask(r)}
                          >
                            <Check />
                            {rowBusy ? t("common.saving") : t("workRequests.accept")}
                          </Button>
                        ) : (
                          <Button
                            data-testid="work-review-approve"
                            disabled={busy !== null}
                            onClick={() => {
                              setError(null);
                              setApproving(r);
                            }}
                          >
                            <Check />
                            {t("workRequests.approve")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {approving && (
        <MeetingFormDialog
          open
          mode="approve"
          testId="work-review-meeting"
          onClose={() => setApproving(null)}
          initial={{
            title: approving.topic,
            description: approving.note,
            ...(first ? { starts_at: first.starts_at, ends_at: first.ends_at } : {}),
          }}
          submit={(input) => approve({ data: { id: approving.id, meeting: input } })}
          onSaved={() => {
            setApproving(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
