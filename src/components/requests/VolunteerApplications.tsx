import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Ban, CircleCheck, HandHeart, Trash2, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useFollowedBranches } from "@/lib/followed-branches";
import { VolunteerAnswerFields } from "@/components/requests/VolunteerAnswerFields";
import {
  APPLICATION_LIMITS,
  EMPTY_ANSWERS,
  approveApplication,
  declineApplication,
  deleteApplication,
  submitApplication,
  useApplicationsToReview,
  useMyApplications,
  validateApplication,
  withdrawApplication,
  type ApplicationInput,
  type MyApplication,
  type ReviewApplication,
  APPROVAL_ROLES,
  type ApprovalRole,
} from "@/lib/volunteer-applications";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { REVIEW_WAITING_KEY } from "@/lib/request-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventDialog } from "@/components/events/EventDialog";

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["my-volunteer-applications"] }),
      qc.invalidateQueries({ queryKey: ["volunteer-applications"] }),
      // A decision changes what waits for approval (menu badge, Requests tab, dashboard card).
      qc.invalidateQueries({ queryKey: [REVIEW_WAITING_KEY] }),
    ]);
}

export function ApplicationStatusBadge({ status }: { status: MyApplication["status"] }) {
  const { t } = useTranslation();
  return (
    <Badge
      data-testid="volunteer-application-status"
      data-status={status}
      variant={status === "approved" ? "default" : status === "submitted" ? "secondary" : "outline"}
    >
      {t(`applications.status.${status}`)}
    </Badge>
  );
}

/** The follower's application to become a volunteer of a branch (one open application at a time). */
export function VolunteerApplicationForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { session, profile } = useAuth();
  const followed = useFollowedBranches(session?.user.id);
  const invalidate = useInvalidate();
  const [input, setInput] = useState<ApplicationInput>({
    ...EMPTY_ANSWERS,
    branch_id: "",
    skills: "",
    phone: profile?.phone ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ApplicationInput, string>>>({});
  const [busy, setBusy] = useState(false);
  const branchId = input.branch_id || followed.data?.[0]?.branch_id || "";
  const set = (key: "branch_id" | "skills" | "phone") => (value: string) =>
    setInput((v) => ({ ...v, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const data = { ...input, branch_id: branchId };
    const found = validateApplication(data);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await submitApplication(data);
      toast.success(t("applications.submitted"));
      await invalidate();
      onSaved();
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <EventDialog open onClose={onClose} title={t("applications.title")}>
      <form
        data-testid="volunteer-application-form"
        onSubmit={(e) => void submit(e)}
        noValidate
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">{t("applications.intro")}</p>
        <div className="space-y-1.5">
          <Label htmlFor="volunteer-application-branch">{t("applications.fields.branch")} *</Label>
          <select
            id="volunteer-application-branch"
            data-testid="volunteer-application-branch"
            value={branchId}
            aria-describedby="volunteer-application-branch-hint"
            onChange={(e) => set("branch_id")(e.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base"
          >
            {(followed.data ?? []).map((b) => (
              <option key={b.branch_id} value={b.branch_id}>
                {b.name}
              </option>
            ))}
          </select>
          <p id="volunteer-application-branch-hint" className="text-xs text-muted-foreground">
            {t("applications.branchHint")}
          </p>
          {errors.branch_id && (
            <p role="alert" className="text-sm text-destructive">
              {t(errors.branch_id)}
            </p>
          )}
        </div>
        <VolunteerAnswerFields
          prefix="volunteer-form"
          value={input}
          errors={errors}
          onChange={(answers) => setInput((v) => ({ ...v, ...answers }))}
        />
        <div className="space-y-1.5">
          <Label htmlFor="volunteer-application-skills">{t("applications.fields.skills")}</Label>
          <Textarea
            id="volunteer-application-skills"
            data-testid="volunteer-application-skills"
            value={input.skills}
            maxLength={APPLICATION_LIMITS.skills}
            aria-invalid={!!errors.skills}
            onChange={(e) => set("skills")(e.target.value)}
            rows={3}
          />
          {errors.skills && (
            <p role="alert" className="text-sm text-destructive">
              {t(errors.skills)}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="volunteer-application-phone">{t("applications.fields.phone")}</Label>
          <Input
            id="volunteer-application-phone"
            data-testid="volunteer-application-phone"
            type="tel"
            maxLength={APPLICATION_LIMITS.phone}
            value={input.phone}
            onChange={(e) => set("phone")(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" data-testid="volunteer-application-submit" disabled={busy}>
            {busy ? t("common.saving") : t("applications.submit")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}

/** The applicant's own applications (newest first) with withdraw / remove. */
export function MyVolunteerApplications() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const list = useMyApplications(session?.user.id);
  const invalidate = useInvalidate();
  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast.success(t(message));
      await invalidate();
    } catch (e) {
      toast.error(translateError(e));
    }
  }
  if (list.isLoading || !list.data?.length) return null;
  return (
    <section aria-labelledby="my-applications-h" className="space-y-3">
      <h2 id="my-applications-h" className="text-xl font-semibold">
        {t("applications.mine")}
      </h2>
      <ul className="space-y-3">
        {list.data.map((a) => (
          <li
            key={a.id}
            data-testid="volunteer-application-row"
            data-application-id={a.id}
            className="space-y-2 rounded-2xl border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <HandHeart className="size-5 text-primary" aria-hidden />
              <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                {t("applications.toBranch", { branch: a.branch })}
              </span>
              <ApplicationStatusBadge status={a.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("applications.sentOn", { date: formatDate(a.created_at) })}
            </p>
            {a.status === "declined" && a.decline_reason && (
              <p data-testid="volunteer-application-decline-reason" className="text-sm">
                {t("applications.declineReason", { reason: a.decline_reason })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {a.status === "submitted" && (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="volunteer-application-withdraw"
                  onClick={() =>
                    void act(() => withdrawApplication(a.id), "applications.withdrawn")
                  }
                >
                  <Undo2 />
                  {t("applications.withdraw")}
                </Button>
              )}
              {a.status !== "submitted" && (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="volunteer-application-delete"
                  onClick={() => void act(() => deleteApplication(a.id), "applications.deleted")}
                >
                  <Trash2 />
                  {t("applications.delete")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Reviewers (the branch's Branch Manager, the region's Regional Director): approve or decline with a reason. */
export function ReviewVolunteerApplications({ filter }: { filter: "open" | "decided" }) {
  const { t } = useTranslation();
  const { session, isManager } = useAuth();
  const list = useApplicationsToReview(session?.user.id, filter, isManager);
  if (!isManager || list.isLoading || !list.data?.length) return null;
  return (
    <section aria-labelledby={`applications-${filter}-h`} className="space-y-3">
      <h2 id={`applications-${filter}-h`} className="text-xl font-semibold">
        {t(filter === "open" ? "applications.toReview" : "applications.decided")}
      </h2>
      <ul className="space-y-3">
        {list.data.map((a) => (
          <ReviewRow key={a.id} application={a} />
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ application: a }: { application: ReviewApplication }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [declining, setDeclining] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    // The reviewer chooses the role: Volunteer (default) or Trustee (reads branch activity, changes nothing).
    [role, setRole] = useState<ApprovalRole>("volunteer");
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(message));
      await invalidate();
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const field = (key: "availability" | "skills" | "phone") =>
    a[key] ? (
      <div>
        <dt className="text-muted-foreground">{t(`applications.fields.${key}`)}</dt>
        <dd className="whitespace-pre-line">{a[key]}</dd>
      </div>
    ) : null;
  return (
    <li
      data-testid="volunteer-application-review-row"
      data-application-id={a.id}
      className="space-y-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <HandHeart className="size-5 text-primary" aria-hidden />
        <span data-testid="volunteer-application-applicant" className="font-semibold">
          {a.applicant_name}
        </span>
        <ApplicationStatusBadge status={a.status} />
      </div>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {[a.applicant_email, a.branch, formatDate(a.created_at)].filter(Boolean).join(" · ")}
      </p>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("applications.review.help")}</dt>
          <dd data-testid="volunteer-application-help" className="whitespace-pre-line">
            {a.motivation}
          </dd>
        </div>
        {a.time_commitment && (
          <div>
            <dt className="text-muted-foreground">{t("applications.fields.time")}</dt>
            <dd data-testid="volunteer-application-time" data-time={a.time_commitment}>
              {t(`applications.time.${a.time_commitment}`, { defaultValue: a.time_commitment })}
            </dd>
          </div>
        )}
        {a.commitment_accepted_at && (
          <div data-testid="volunteer-application-commitment">
            <dt className="sr-only">{t("applications.review.commitmentLabel")}</dt>
            <dd className="flex items-center gap-1.5">
              <CircleCheck className="size-4 text-primary" aria-hidden />
              {t("applications.review.commitment")}
            </dd>
          </div>
        )}
        {field("availability")}
        {field("skills")}
        {field("phone")}
      </dl>
      {a.status === "submitted" && !declining && (
        <fieldset
          data-testid="volunteer-application-approve-role"
          data-value={role}
          aria-describedby={`approve-role-hint-${a.id}`}
          className="space-y-2"
        >
          <legend className="text-sm font-medium">{t("applications.approveAs")}</legend>
          <div className="flex flex-wrap gap-4">
            {APPROVAL_ROLES.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`approve-role-${a.id}`}
                  value={value}
                  checked={role === value}
                  onChange={() => setRole(value)}
                  data-testid={`volunteer-application-approve-role-${value}`}
                  className="size-4"
                />
                {t(`common.roles.${value}`)}
              </label>
            ))}
          </div>
          <p
            id={`approve-role-hint-${a.id}`}
            data-testid="volunteer-application-approve-role-hint"
            className="text-xs text-muted-foreground"
          >
            {t("common.trusteeHint")}
          </p>
        </fieldset>
      )}
      {a.status === "submitted" && !declining && (
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="volunteer-application-approve"
            data-role={role}
            disabled={busy}
            onClick={() =>
              void act(
                () => approveApplication(a.id, role),
                role === "trustee" ? "applications.approvedTrustee" : "applications.approved",
              )
            }
          >
            <CircleCheck />
            {t("applications.approve")}
          </Button>
          <Button
            variant="outline"
            data-testid="volunteer-application-decline"
            disabled={busy}
            onClick={() => setDeclining(true)}
          >
            <Ban />
            {t("applications.decline")}
          </Button>
        </div>
      )}
      {declining && (
        <div className="space-y-2">
          <Label htmlFor={`decline-${a.id}`}>{t("applications.declineReasonLabel")}</Label>
          <Textarea
            id={`decline-${a.id}`}
            data-testid="volunteer-application-decline-reason-input"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDeclining(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="volunteer-application-decline-confirm"
              variant="destructive"
              disabled={busy || reason.trim().length < APPLICATION_LIMITS.declineMin}
              onClick={() =>
                void act(() => declineApplication(a.id, reason), "applications.declined")
              }
            >
              {t("applications.decline")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
