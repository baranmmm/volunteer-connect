import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Megaphone } from "lucide-react";
import {
  announceEvent,
  announceOptions,
  listAnnouncements,
  type AnnounceTarget,
} from "@/lib/event-managers.functions";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventDialog } from "./EventDialog";

/**
 * "Announce to subscribers" for an upcoming published public event: the manager picks a target they may use (BM their
 * branch; RD a branch of their region or the region; NC everyone, a region or a branch), sees how many subscribers
 * it reaches (dry run), then queues it. Emails go out through the outbox within the daily limit.
 */
export function AnnounceButton({
  eventId,
  branchId,
  regionId,
}: {
  eventId: string;
  branchId: string | null;
  regionId: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        data-testid="announce-open"
        variant="outline"
        className="h-11"
        onClick={() => setOpen(true)}
      >
        <Megaphone />
        {t("announce.button")}
      </Button>
      {open && (
        <AnnounceDialog
          eventId={eventId}
          branchId={branchId}
          regionId={regionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AnnounceDialog({
  eventId,
  branchId,
  regionId,
  onClose,
}: {
  eventId: string;
  branchId: string | null;
  regionId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const optionsFn = useServerFn(announceOptions),
    announce = useServerFn(announceEvent),
    historyFn = useServerFn(listAnnouncements);
  const options = useQuery({ queryKey: ["announce-options"], queryFn: () => optionsFn() });
  const history = useQuery({
    queryKey: ["announcements", eventId],
    queryFn: () => historyFn({ data: { eventId } }),
  });
  const [target, setTarget] = useState<AnnounceTarget | null>(null),
    [branch, setBranch] = useState<string>(""),
    [region, setRegion] = useState<string>("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const o = options.data;
  const targets: AnnounceTarget[] = o
    ? [
        ...(o.branches.length ? (["branch"] as const) : []),
        ...(o.regions.length ? (["region"] as const) : []),
        ...(o.all ? (["all"] as const) : []),
      ]
    : [];
  // Defaults: the event's own branch / region when the manager may use them.
  useEffect(() => {
    if (!o || target) return;
    const ownBranch = o.branches.find((b) => b.id === branchId);
    if (ownBranch) {
      setTarget("branch");
      setBranch(ownBranch.id);
    } else if (o.regions.some((r) => r.id === regionId)) {
      setTarget("region");
      setRegion(regionId ?? "");
    } else if (o.all) setTarget("all");
    else if (o.branches[0]) {
      setTarget("branch");
      setBranch(o.branches[0].id);
    } else if (o.regions[0]) {
      setTarget("region");
      setRegion(o.regions[0].id);
    }
  }, [o, target, branchId, regionId]);
  const ready = !!target && (target === "all" || (target === "branch" ? !!branch : !!region));
  const payload = {
    eventId,
    target: target ?? "branch",
    branchId: target === "branch" ? branch || null : null,
    regionId: target === "region" ? region || null : null,
  };
  const count = useQuery({
    queryKey: ["announce-count", eventId, payload.target, payload.branchId, payload.regionId],
    queryFn: () => announce({ data: { ...payload, dryRun: true } }),
    enabled: ready,
    staleTime: 0,
  });
  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const n = await announce({ data: { ...payload, dryRun: false } });
      await Promise.all(
        [
          ["announcements", eventId],
          ["announce-count", eventId],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      toast.success(t("announce.queued", { count: n }));
      onClose();
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <EventDialog
      open
      onClose={() => !busy && onClose()}
      title={t("announce.title")}
      testId="announce-dialog"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("announce.hint")}</p>
        {options.isLoading ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : options.isError ? (
          <p role="alert" className="text-destructive">
            {translateError(options.error)}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("announce.target")}</Label>
              <Select
                value={target ?? ""}
                disabled={busy}
                onValueChange={(v) => {
                  const next = targets.find((x) => x === v);
                  if (!next) return;
                  setTarget(next);
                  if (next === "branch" && !branch) setBranch(o?.branches[0]?.id ?? "");
                  if (next === "region" && !region) setRegion(o?.regions[0]?.id ?? "");
                }}
              >
                <SelectTrigger
                  data-testid="announce-target"
                  aria-label={t("announce.target")}
                  className="h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((x) => (
                    <SelectItem key={x} value={x} data-testid={`announce-target-option-${x}`}>
                      {t(`announce.targets.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {target === "branch" && (
              <div className="space-y-1.5">
                <Label>{t("events.branch")}</Label>
                <Select value={branch} disabled={busy} onValueChange={setBranch}>
                  <SelectTrigger
                    data-testid="announce-branch"
                    aria-label={t("events.branch")}
                    className="h-11"
                  >
                    <SelectValue placeholder={t("auth.chooseBranch")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(o?.branches ?? []).map((b) => (
                      <SelectItem
                        key={b.id}
                        value={b.id}
                        data-testid={`announce-branch-option-${b.id}`}
                      >
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {target === "region" && (
              <div className="space-y-1.5">
                <Label>{t("events.region")}</Label>
                <Select value={region} disabled={busy} onValueChange={setRegion}>
                  <SelectTrigger
                    data-testid="announce-region"
                    aria-label={t("events.region")}
                    className="h-11"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(o?.regions ?? []).map((r) => (
                      <SelectItem
                        key={r.id}
                        value={r.id}
                        data-testid={`announce-region-option-${r.id}`}
                      >
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
        <p
          data-testid="announce-count"
          data-count={count.data ?? ""}
          role="status"
          className="text-sm font-medium"
        >
          {!ready
            ? ""
            : count.isLoading
              ? t("common.loading")
              : count.isError
                ? translateError(count.error)
                : t("announce.recipients", { count: count.data ?? 0 })}
        </p>
        <p className="text-xs text-muted-foreground">{t("announce.limitHint")}</p>
        {error && (
          <p data-testid="announce-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="announce-confirm"
            disabled={busy || !ready || !count.data}
            onClick={() => void confirm()}
          >
            <Megaphone />
            {busy ? t("common.saving") : t("announce.send")}
          </Button>
        </div>
        <section aria-labelledby="announce-history-title" className="space-y-2 border-t pt-4">
          <h3 id="announce-history-title" className="text-sm font-semibold">
            {t("announce.history")}
          </h3>
          {history.data?.length ? (
            <ul data-testid="announce-history" className="space-y-1 text-sm">
              {history.data.map((h) => (
                <li key={h.id} data-testid="announce-history-item" data-target={h.target}>
                  {t("announce.historyItem", {
                    date: formatDate(h.created_at, { dateStyle: "medium", timeStyle: "short" }),
                    target:
                      h.target === "branch"
                        ? h.branch
                        : h.target === "region"
                          ? h.region
                          : t("announce.targets.all"),
                    count: h.recipients,
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("announce.noHistory")}</p>
          )}
        </section>
      </div>
    </EventDialog>
  );
}
