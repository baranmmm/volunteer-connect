import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { FileText, Globe2, Lightbulb, Plus, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { EVENT_CATEGORIES, londonInput, londonToIso } from "@/lib/event-rules";
import {
  emptyRequestForm,
  requestFormFromRow,
  requestPayload,
  validateRequestForm,
  MAX_REQUEST_FILES,
  REQUEST_DESCRIPTION_MAX,
  REQUEST_FILE_ACCEPT,
  REQUEST_NOTES_MAX,
  REQUEST_ORGANIZER_MAX,
  REQUEST_REASON_MAX,
  REQUEST_SOURCES,
  REQUEST_TITLE_MAX,
  type EventRequest,
  type RequestFormFields,
  type RequestMedia,
  type RequestType,
} from "@/lib/event-requests";
import {
  deleteRequestMedia,
  listRequestMedia,
  managerUpdateEventRequest,
  reserveRequestMedia,
  submitEventRequest,
  updateEventRequest,
} from "@/lib/event-requests.functions";
import {
  prepareRequestFile,
  removeStoredRequestFile,
  uploadRequestFile,
} from "@/lib/request-files";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventDialog } from "@/components/events/EventDialog";
import { TimeSelect } from "@/components/events/TimeSelect";

const P = "event-request-form";
const ORDER = [
  "title",
  "organizer",
  "source",
  "start",
  "end",
  "start-date",
  "end-date",
  "alt-start",
  "alt-end",
  "alt-start-date",
  "alt-end-date",
  "location",
  "online-url",
  "source-url",
  "expected-attendees",
  "description",
  "reason",
  "notes",
];
type Pending = { key: string; file: File; name: string };

/**
 * Request form. New requests start with the type: an event someone else organises ("external") or one we could
 * organise ("proposal"). `request` edits a request: the requester while submitted, or a reviewer (`mode="manager"`,
 * who also sets the category). The type never changes.
 */
export function EventRequestForm({
  request,
  mode = "requester",
  onClose,
  onSaved,
}: {
  request?: EventRequest;
  mode?: "requester" | "manager";
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { roles, profile, session } = useAuth();
  const qc = useQueryClient();
  const submitFn = useServerFn(submitEventRequest),
    updateFn = useServerFn(updateEventRequest),
    managerFn = useServerFn(managerUpdateEventRequest),
    reserveFn = useServerFn(reserveRequestMedia),
    removeFn = useServerFn(deleteRequestMedia),
    mediaFn = useServerFn(listRequestMedia);
  const manager = mode === "manager";
  const [type, setType] = useState<RequestType | null>(request?.request_type ?? null);
  const [f, setF] = useState<RequestFormFields>(() =>
    request ? requestFormFromRow(request) : emptyRequestForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]),
    [removed, setRemoved] = useState<string[]>([]),
    [fileErrors, setFileErrors] = useState<string[]>([]);
  const existing = useQuery({
    queryKey: ["event-request-media", request?.id, session?.user.id],
    queryFn: () => mediaFn({ data: { id: request!.id } }),
    enabled: !!request && request.attachment_count > 0,
  });
  const kept = (existing.data ?? []).filter((m: RequestMedia) => !removed.includes(m.id));
  const formRef = useRef<HTMLFormElement>(null);
  const endTouched = useRef(!!request),
    altEndTouched = useRef(!!request?.alt_end);
  useEffect(() => {
    if (type) setF((cur) => ({ ...cur, type }));
  }, [type]);
  const set = <K extends keyof RequestFormFields>(key: K, value: RequestFormFields[K]) =>
    setF((cur) => ({ ...cur, [key]: value }));
  const regionRequest = request ? request.scope === "region" : roles.includes("branch_manager");
  const external = type === "external";
  const showAttachments = external || manager;

  function setStart(alt: boolean, value: string) {
    setF((cur) => {
      const next = { ...cur, [alt ? "altStart" : "start"]: value };
      if ((alt ? altEndTouched : endTouched).current || value.length !== 16) return next;
      try {
        next[alt ? "altEnd" : "end"] = londonInput(
          new Date(Date.parse(londonToIso(value)) + 2 * 3600 * 1000),
        );
      } catch {
        /* reported on submit */
      }
      return next;
    });
  }
  function setEnd(alt: boolean, value: string) {
    (alt ? altEndTouched : endTouched).current = true;
    set(alt ? "altEnd" : "end", value);
  }
  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_REQUEST_FILES - kept.length - pending.length;
    const files = Array.from(list);
    setFileErrors(files.length > room ? [t("requests.errors.tooManyFiles")] : []);
    setPending((cur) => [
      ...cur,
      ...files
        .slice(0, Math.max(0, room))
        .map((file) => ({ key: crypto.randomUUID(), file, name: file.name })),
    ]);
  }

  /** Removals first (Storage, then the row), then new files (reserve a path, upload; drop the row if upload fails). */
  async function saveFiles(id: string) {
    const failed: string[] = [];
    for (const m of (existing.data ?? []).filter((x: RequestMedia) => removed.includes(x.id))) {
      try {
        if (m.uploaded) await removeStoredRequestFile(m.storage_path);
        await removeFn({ data: { mediaId: m.id } });
      } catch (e) {
        failed.push(
          t("events.fileRejected", { name: m.original_name ?? "", reason: translateError(e) }),
        );
      }
    }
    let count = kept.length;
    for (const p of pending) {
      let reserved: { id: string; storage_path: string } | null = null;
      try {
        const prepared = await prepareRequestFile(p.file, count);
        reserved = await reserveFn({
          data: {
            id,
            kind: prepared.kind,
            extension: prepared.extension,
            originalName: p.name.slice(0, 255),
          },
        });
        await uploadRequestFile(reserved.storage_path, prepared.file);
        count++;
      } catch (e) {
        failed.push(t("events.fileRejected", { name: p.name, reason: translateError(e) }));
        if (reserved) await removeFn({ data: { mediaId: reserved.id } }).catch(() => undefined);
      }
    }
    return failed;
  }

  async function submit() {
    if (busy || !type) return;
    const validation = validateRequestForm({ ...f, type });
    if (!f.allDay)
      for (const [key, value] of [
        ["start", f.start],
        ["end", f.end],
        ...(f.hasAlt && !external
          ? [
              ["alt-start", f.altStart],
              ["alt-end", f.altEnd],
            ]
          : []),
      ] as const)
        if (value && value.length !== 16) validation[key] = "events.fieldRequired";
    setErrors(validation);
    const first = ORDER.find((key) => validation[key]);
    if (first) {
      const value =
        first === "start"
          ? f.start
          : first === "end"
            ? f.end
            : first === "alt-start"
              ? f.altStart
              : first === "alt-end"
                ? f.altEnd
                : null;
      const target = value === null ? first : `${first}-${value.slice(0, 10) ? "time" : "date"}`;
      requestAnimationFrame(() => {
        const node = formRef.current?.querySelector<HTMLElement>(`[data-testid="${P}-${target}"]`);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        node?.focus();
      });
      return;
    }
    setBusy(true);
    setError("");
    setFileErrors([]);
    let id = request?.id ?? null;
    try {
      const payload = requestPayload({ ...f, type });
      if (id && manager) await managerFn({ data: { id, request: payload } });
      else if (id) await updateFn({ data: { id, request: payload } });
      else id = await submitFn({ data: payload });
      const failed = await saveFiles(id);
      await Promise.all(
        [
          "my-event-requests",
          "event-request",
          "managed-event-requests",
          "pending-event-requests",
          "event-request-media",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
      if (failed.length) {
        // The request is saved; only some files were not.
        setFileErrors(failed);
        toast.error(t("requests.filesNotSaved", { count: failed.length }));
        setPending([]);
        setRemoved([]);
        return;
      }
      toast.success(t(request ? "requests.updated" : "requests.submitted"));
      onSaved(id);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`${P}-${key}-error`} role="alert" className="text-sm text-destructive">
        {t(errors[key])}
      </p>
    ) : null;
  const describe = (key: string) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${P}-${key}-error` } : {};
  function dateTime(
    key: "start" | "end" | "alt-start" | "alt-end",
    label: string,
    value: string,
    onChange: (v: string) => void,
    required: boolean,
  ) {
    const day = value.slice(0, 10),
      time = value.slice(11, 16);
    const combine = (d: string, tm: string) =>
      d && tm ? `${d}T${tm}` : d ? `${d}T` : tm ? `T${tm}` : "";
    return (
      <fieldset className="min-w-0 space-y-1.5" disabled={busy}>
        <legend className="mb-1.5 text-sm font-medium leading-none">
          {label}
          {required && " *"}
        </legend>
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
          <Input
            id={`${P}-${key}-date`}
            data-testid={`${P}-${key}-date`}
            type="date"
            aria-label={`${label} – ${t("requests.dateLabel")}`}
            aria-required={required}
            {...describe(key)}
            value={day}
            onChange={(e) => onChange(combine(e.target.value, time))}
            className="h-11 min-w-0"
          />
          <TimeSelect
            id={`${P}-${key}-time`}
            testId={`${P}-${key}-time`}
            label={`${label} – ${t("requests.timeLabel")}`}
            placeholder={t("events.timePlaceholder")}
            value={time}
            onChange={(tm) => onChange(combine(day, tm))}
            disabled={busy}
            invalid={!!errors[key]}
            describedBy={errors[key] ? `${P}-${key}-error` : undefined}
          />
        </div>
        {fieldError(key)}
      </fieldset>
    );
  }
  function dateField(
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    required: boolean,
  ) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${P}-${key}`}>
          {label}
          {required && " *"}
        </Label>
        <Input
          id={`${P}-${key}`}
          data-testid={`${P}-${key}`}
          type="date"
          aria-required={required}
          {...describe(key)}
          value={value}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 min-w-0"
        />
        {fieldError(key)}
      </div>
    );
  }
  function text(
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { required?: boolean; max?: number; type?: string; hint?: string } = {},
  ) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${P}-${key}`}>
          {label}
          {opts.required && " *"}
        </Label>
        <Input
          id={`${P}-${key}`}
          data-testid={`${P}-${key}`}
          type={opts.type ?? "text"}
          value={value}
          maxLength={opts.max}
          aria-required={opts.required}
          {...describe(key)}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          className="h-11"
        />
        {opts.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
        {fieldError(key)}
      </div>
    );
  }
  function area(
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    max: number,
  ) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${P}-${key}`}>{label}</Label>
        <Textarea
          id={`${P}-${key}`}
          data-testid={`${P}-${key}`}
          value={value}
          maxLength={max}
          rows={3}
          disabled={busy}
          {...describe(key)}
          onChange={(e) => onChange(e.target.value)}
        />
        {fieldError(key)}
      </div>
    );
  }
  const dates = (alt: boolean) =>
    f.allDay ? (
      <>
        {dateField(
          alt ? "alt-start-date" : "start-date",
          t("events.startDate"),
          alt ? f.altStartDate : f.startDate,
          (v) => set(alt ? "altStartDate" : "startDate", v),
          !alt,
        )}
        {dateField(
          alt ? "alt-end-date" : "end-date",
          t("events.endDate"),
          alt ? f.altEndDate : f.endDate,
          (v) => set(alt ? "altEndDate" : "endDate", v),
          false,
        )}
      </>
    ) : (
      <>
        {dateTime(
          alt ? "alt-start" : "start",
          t("events.start"),
          alt ? f.altStart : f.start,
          (v) => setStart(alt, v),
          !alt,
        )}
        {dateTime(
          alt ? "alt-end" : "end",
          t("events.end"),
          alt ? f.altEnd : f.end,
          (v) => setEnd(alt, v),
          !alt,
        )}
      </>
    );
  const title = manager
    ? t("requests.editRequest")
    : request
      ? t("requests.editTitle")
      : t("requests.formTitle");

  if (!type)
    return (
      <EventDialog open onClose={onClose} title={title}>
        <div data-testid="event-request-type-choice" className="grid gap-3 sm:grid-cols-2">
          {(["external", "proposal"] as const).map((value) => {
            const Icon = value === "external" ? Globe2 : Lightbulb;
            return (
              <button
                key={value}
                type="button"
                data-testid={`event-request-type-${value}`}
                onClick={() => setType(value)}
                className="flex min-h-28 flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-6 text-primary" aria-hidden />
                <span className="font-semibold">{t(`requests.typeChoice.${value}`)}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`requests.typeChoice.${value}Hint`)}
                </span>
              </button>
            );
          })}
        </div>
      </EventDialog>
    );

  return (
    <EventDialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
    >
      <form
        ref={formRef}
        noValidate
        data-testid={P}
        data-type={type}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p
          data-testid={`${P}-scope`}
          data-scope={regionRequest ? "region" : "branch"}
          className="text-sm font-medium"
        >
          {t(`requests.types.${type}`)} ·{" "}
          {regionRequest
            ? t("requests.scopeRegion", {
                region: request?.region_name ?? profile?.branches?.regions?.name ?? "",
              })
            : t("requests.scopeBranch", {
                branch: request?.branch_name ?? profile?.branches?.name ?? "",
              })}
        </p>
        <p className="text-sm text-muted-foreground">{t("requests.requiredNote")}</p>
        {text("title", t("requests.titleLabel"), f.title, (v) => set("title", v), {
          required: true,
          max: REQUEST_TITLE_MAX,
        })}
        {external && (
          <>
            {text("organizer", t("requests.organizer"), f.organizer, (v) => set("organizer", v), {
              required: true,
              max: REQUEST_ORGANIZER_MAX,
            })}
            <div className="space-y-1.5">
              <Label>{t("requests.sourceQuestion")} *</Label>
              <Select
                value={f.source}
                disabled={busy}
                onValueChange={(v) => set("source", REQUEST_SOURCES.find((s) => s === v) ?? "")}
              >
                <SelectTrigger
                  data-testid={`${P}-source`}
                  aria-label={t("requests.sourceQuestion")}
                  aria-invalid={!!errors["source"]}
                  className="h-11"
                >
                  <SelectValue placeholder={t("requests.choose")} />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_SOURCES.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`${P}-source-option-${s}`}>
                      {t(`requests.sources.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError("source")}
            </div>
          </>
        )}
        {(!external || manager) &&
          area(
            "description",
            t("requests.description"),
            f.description,
            (v) => set("description", v),
            REQUEST_DESCRIPTION_MAX,
          )}
        {manager && (
          <div className="space-y-1.5">
            <Label>
              {t("events.category")}
              {external && " *"}
            </Label>
            <Select value={f.category} disabled={busy} onValueChange={(v) => set("category", v)}>
              <SelectTrigger
                data-testid={`${P}-category`}
                aria-label={t("events.category")}
                className="h-11"
              >
                <SelectValue placeholder={t("requests.choose")} />
              </SelectTrigger>
              <SelectContent>
                {EVENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} data-testid={`${P}-category-option-${c}`}>
                    {t(`events.categories.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <section className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">
            {external ? t("requests.when") : t("requests.proposed")}
          </h3>
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id={`${P}-all-day`}
              data-testid={`${P}-all-day`}
              checked={f.allDay}
              disabled={busy}
              onCheckedChange={(v) => {
                set("allDay", v);
                setErrors({});
              }}
            />
            <Label htmlFor={`${P}-all-day`}>{t("events.allDay")}</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">{dates(false)}</div>
          {!external &&
            (f.hasAlt ? (
              <div data-testid={`${P}-alternative`} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">{t("requests.alternative")}</h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`${P}-remove-alternative`}
                    disabled={busy}
                    onClick={() =>
                      setF((cur) => ({
                        ...cur,
                        hasAlt: false,
                        altStart: "",
                        altEnd: "",
                        altStartDate: "",
                        altEndDate: "",
                      }))
                    }
                  >
                    <X />
                    {t("requests.removeAlternative")}
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">{dates(true)}</div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                data-testid={`${P}-add-alternative`}
                disabled={busy}
                onClick={() => set("hasAlt", true)}
              >
                <Plus />
                {t("requests.addAlternative")}
              </Button>
            ))}
        </section>
        <section className="space-y-3 border-t pt-4">
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id={`${P}-online`}
              data-testid={`${P}-online`}
              checked={f.isOnline}
              disabled={busy}
              onCheckedChange={(v) => set("isOnline", v)}
            />
            <Label htmlFor={`${P}-online`}>{t("requests.online")}</Label>
          </div>
          {f.isOnline
            ? text("online-url", t("requests.onlineUrl"), f.onlineUrl, (v) => set("onlineUrl", v), {
                type: "url",
                max: 2000,
                hint: t("requests.onlineUrlHint"),
              })
            : text("location", t("requests.location"), f.location, (v) => set("location", v), {
                max: 500,
              })}
          {external &&
            text("source-url", t("requests.sourceUrl"), f.sourceUrl, (v) => set("sourceUrl", v), {
              type: "url",
              max: 2000,
              hint: t("requests.onlineUrlHint"),
            })}
          {!external && (
            <div className="space-y-1.5">
              <Label htmlFor={`${P}-expected-attendees`}>{t("requests.expectedAttendees")}</Label>
              <Input
                id={`${P}-expected-attendees`}
                data-testid={`${P}-expected-attendees`}
                type="number"
                min={1}
                step={1}
                value={f.expectedAttendees}
                {...describe("expected-attendees")}
                disabled={busy}
                onChange={(e) => set("expectedAttendees", e.target.value)}
                className="h-11 sm:w-48"
              />
              {fieldError("expected-attendees")}
            </div>
          )}
          {external
            ? area("notes", t("requests.notes"), f.notes, (v) => set("notes", v), REQUEST_NOTES_MAX)
            : area(
                "reason",
                t("requests.reason"),
                f.reason,
                (v) => set("reason", v),
                REQUEST_REASON_MAX,
              )}
        </section>
        {showAttachments && (
          <section className="space-y-2 border-t pt-4">
            <Label
              htmlFor={`${P}-attachments`}
              className="flex min-h-11 items-center gap-2 text-primary"
            >
              <Upload className="size-4" aria-hidden />
              {t("requests.attachmentsLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("requests.attachmentsHint")}</p>
            <Input
              id={`${P}-attachments`}
              data-testid={`${P}-attachments`}
              type="file"
              accept={REQUEST_FILE_ACCEPT}
              multiple
              disabled={busy || kept.length + pending.length >= MAX_REQUEST_FILES}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <ul className="space-y-1">
              {kept.map((m: RequestMedia) => (
                <li
                  key={m.id}
                  data-testid={`${P}-attachment`}
                  className="flex items-center gap-2 text-sm"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 break-all">
                    {m.original_name ?? m.storage_path.split("/").pop()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("events.remove")}
                    title={t("events.remove")}
                    disabled={busy}
                    onClick={() => setRemoved((cur) => [...cur, m.id])}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              {pending.map((p) => (
                <li
                  key={p.key}
                  data-testid={`${P}-attachment`}
                  className="flex items-center gap-2 text-sm"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 break-all">{p.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("events.remove")}
                    title={t("events.remove")}
                    disabled={busy}
                    onClick={() => setPending((cur) => cur.filter((x) => x.key !== p.key))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {fileErrors.length > 0 && (
          <ul
            data-testid={`${P}-file-errors`}
            role="alert"
            className="space-y-1 text-sm text-destructive"
          >
            {fileErrors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        {error && (
          <p data-testid={`${P}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid={manager ? "manager-request-edit-save" : `${P}-submit`}
            type="submit"
            disabled={busy}
          >
            {busy ? t("common.saving") : request ? t("requests.saveChanges") : t("requests.submit")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}
