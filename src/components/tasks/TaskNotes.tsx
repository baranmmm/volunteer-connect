import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AtSign, Pencil, Trash2, X } from "lucide-react";
import {
  TASK_NOTE_MAX,
  insertMention,
  typedMentionTrigger,
  type Person,
  type TaskNote,
} from "@/lib/tasks";
import {
  addTaskNote,
  deleteTaskNote,
  listTaskMentionPeople,
  listTaskNotes,
  updateTaskNote,
} from "@/lib/tasks.functions";
import { submitOnEnter } from "@/lib/enter-submit";
import { formatDate, translateError } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { EventDialog } from "@/components/events/EventDialog";

type Mention = { id: string; full_name: string | null };

/**
 * The notes thread of a task (oldest first). Assignees, the creator, the scope's managers and the branch's trustees
 * write notes (`canWrite` mirrors can_add_note); authors edit and delete their own. "@" or the Mention button opens a
 * picker of the people who can see the task; chosen people are sent as `mentions` (the database checks them and sends the notices).
 */
export function TaskNotes({
  taskId,
  canWrite,
  highlightId,
}: {
  taskId: string;
  canWrite: boolean;
  /** Highlighted and scrolled into view once (from a note notice). */
  highlightId?: string | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fetchNotes = useServerFn(listTaskNotes);
  // The highlighted note comes into view once, when it first appears.
  const scrolled = useRef<string | null>(null);
  const scrollToHighlight = useCallback(
    (el: HTMLLIElement | null) => {
      if (!el || !highlightId || scrolled.current === highlightId) return;
      scrolled.current = highlightId;
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    },
    [highlightId],
  );
  const fetchPeople = useServerFn(listTaskMentionPeople);
  const add = useServerFn(addTaskNote);
  const update = useServerFn(updateTaskNote);
  const remove = useServerFn(deleteTaskNote);
  const notes = useQuery({
    queryKey: ["tasks", "notes", taskId],
    queryFn: () => fetchNotes({ data: { id: taskId } }),
  });
  const people = useQuery({
    queryKey: ["tasks", "mention-people", taskId],
    queryFn: () => fetchPeople({ data: { id: taskId } }),
    enabled: canWrite,
    staleTime: 60000,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Notes change note_count on the task lists, so everything under "tasks" is refetched.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError("");
    try {
      await remove({ data: { noteId: deleting.id } });
      toast.success(t("tasks.notes.deleted"));
      setDeleting(null);
      await refresh();
    } catch (e) {
      setDeleteError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  const list = notes.data ?? [];
  return (
    <section
      data-testid="task-notes"
      data-count={list.length}
      aria-labelledby="task-notes-title"
      className="min-w-0 space-y-3 border-t pt-4"
    >
      <h3 id="task-notes-title" className="font-semibold">
        {t("tasks.notes.title")}
      </h3>
      {notes.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : notes.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("tasks.notes.loadError")}
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="task-notes-empty">
          {t("tasks.notes.empty")}
        </p>
      ) : (
        <ol className="min-w-0 space-y-3">
          {list.map((note) => (
            <li
              key={note.id}
              data-testid="task-note"
              data-note-id={note.id}
              data-mine={note.mine}
              data-highlighted={note.id === highlightId ? "true" : undefined}
              ref={note.id === highlightId ? scrollToHighlight : undefined}
              tabIndex={note.id === highlightId ? -1 : undefined}
              className={cn(
                "min-w-0 space-y-1.5 rounded-xl border bg-card p-3",
                note.id === highlightId && "border-primary ring-2 ring-primary/40",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="min-w-0 truncate font-medium" data-testid="task-note-author">
                  {note.author_name ?? t("common.formerMember")}
                </span>
                <time dateTime={note.created_at} className="text-xs text-muted-foreground">
                  {formatDate(note.created_at, { dateStyle: "medium", timeStyle: "short" })}
                </time>
                {note.edited && (
                  <span className="text-xs text-muted-foreground" data-testid="task-note-edited">
                    {t("tasks.notes.edited")}
                  </span>
                )}
              </div>
              {editing === note.id ? (
                <NoteComposer
                  mode="edit"
                  people={people.data ?? []}
                  peopleLoading={people.isLoading}
                  initialBody={note.body}
                  initialMentions={note.mentions}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (body, mentions) => {
                    await update({ data: { noteId: note.id, body, mentions } });
                    toast.success(t("tasks.notes.saved"));
                    setEditing(null);
                    await refresh();
                  }}
                />
              ) : (
                <>
                  <p
                    className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"
                    data-testid="task-note-body"
                  >
                    {note.body}
                  </p>
                  {note.mentions.length > 0 && (
                    <p
                      className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
                      data-testid="task-note-mentions"
                    >
                      {t("tasks.notes.mentioned", {
                        names: note.mentions
                          .map((m) => m.full_name ?? t("common.formerMember"))
                          .join(", "),
                      })}
                    </p>
                  )}
                  {note.mine && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11"
                        data-testid="task-note-edit"
                        onClick={() => setEditing(note.id)}
                      >
                        <Pencil />
                        {t("tasks.notes.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 text-destructive hover:text-destructive"
                        data-testid="task-note-delete"
                        onClick={() => {
                          setDeleteError("");
                          setDeleting(note);
                        }}
                      >
                        <Trash2 />
                        {t("tasks.notes.delete")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {canWrite && editing === null && (
        <NoteComposer
          mode="new"
          people={people.data ?? []}
          peopleLoading={people.isLoading}
          onSubmit={async (body, mentions) => {
            await add({ data: { id: taskId, body, mentions } });
            toast.success(t("tasks.notes.added"));
            await refresh();
          }}
        />
      )}
      <EventDialog
        open={!!deleting}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        title={t("tasks.notes.deleteTitle")}
        testId="task-note-delete-dialog"
      >
        <p className="text-muted-foreground">{t("tasks.notes.deleteText")}</p>
        {deleteError && (
          <p role="alert" className="mt-3 text-destructive">
            {deleteError}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="h-11"
            disabled={busy}
            data-testid="task-note-delete-cancel"
            onClick={() => setDeleting(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={busy}
            data-testid="task-note-delete-confirm"
            onClick={() => void confirmDelete()}
          >
            <Trash2 />
            {t("tasks.notes.delete")}
          </Button>
        </div>
      </EventDialog>
    </section>
  );
}

/** The textarea with the mention picker and chips, for a new note or an edit. */
function NoteComposer({
  mode,
  people,
  peopleLoading,
  initialBody = "",
  initialMentions = [],
  onSubmit,
  onCancel,
}: {
  mode: "new" | "edit";
  people: Person[];
  peopleLoading: boolean;
  initialBody?: string;
  initialMentions?: Mention[];
  onSubmit: (body: string, mentions: string[]) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<Mention[]>(initialMentions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef(initialBody.length);
  const inputId = mode === "new" ? "task-note-new" : "task-note-edit-input";
  const name = (p: Pick<Person, "full_name">) => p.full_name ?? t("common.formerMember");
  const options = useMemo(
    () => people.filter((p) => !mentions.some((m) => m.id === p.id)),
    [people, mentions],
  );

  function choose(p: Person) {
    const next = insertMention(body, caret.current, name(p));
    setBody(next.body);
    caret.current = next.caret;
    setMentions((cur) => (cur.some((m) => m.id === p.id) ? cur : [...cur, p]));
    setPickerOpen(false);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const text = body.trim();
    if (!text) return setError(t("tasks.notes.required"));
    if (text.length > TASK_NOTE_MAX) return setError(t("tasks.notes.tooLong"));
    setError("");
    setBusy(true);
    try {
      await onSubmit(
        text,
        mentions.map((m) => m.id),
      );
      if (mode === "new") {
        setBody("");
        setMentions([]);
        caret.current = 0;
      }
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="min-w-0 space-y-2" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className={mode === "new" ? "text-sm font-medium" : "sr-only"}>
        {mode === "new" ? t("tasks.notes.newLabel") : t("tasks.notes.edit")}
      </label>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverAnchor asChild>
          <Textarea
            ref={area}
            id={inputId}
            data-testid="task-note-input"
            value={body}
            rows={3}
            maxLength={TASK_NOTE_MAX}
            placeholder={t("tasks.notes.placeholder")}
            aria-invalid={!!error}
            aria-describedby={`${inputId}-hint`}
            onKeyDown={submitOnEnter}
            onChange={(e) => {
              const next = e.target.value;
              const at = e.target.selectionStart ?? next.length;
              caret.current = at;
              if (typedMentionTrigger(body, next, at) && !peopleLoading) setPickerOpen(true);
              setBody(next);
            }}
            onSelect={(e) => {
              caret.current = e.currentTarget.selectionStart ?? caret.current;
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
          align="start"
          collisionPadding={16}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            area.current?.focus();
          }}
        >
          <Command
            filter={(value, search) =>
              (people.find((p) => p.id === value)?.full_name ?? "")
                .toLowerCase()
                .includes(search.toLowerCase())
                ? 1
                : 0
            }
          >
            <CommandInput
              data-testid="task-note-mention-search"
              placeholder={t("work.people.search")}
              aria-label={t("work.people.search")}
            />
            <CommandList className="max-h-60">
              <CommandEmpty>
                {people.length ? t("work.people.noMatch") : t("tasks.notes.mentionNone")}
              </CommandEmpty>
              <CommandGroup>
                {options.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => choose(p)}
                    data-testid="task-note-mention-option"
                    data-user-id={p.id}
                    className="min-h-11"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={name(p)}>
                        {name(p)}
                      </span>
                      {p.role && (
                        <span className="block text-xs text-muted-foreground">
                          {t(`common.roles.${p.role}`)}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {mentions.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={t("tasks.notes.mentionsLabel")}>
          {mentions.map((m) => (
            <li
              key={m.id}
              data-testid="task-note-mention-chip"
              data-user-id={m.id}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-secondary py-0.5 pl-2.5 pr-1 text-sm"
            >
              <span className="min-w-0 truncate">@{name(m)}</span>
              <button
                type="button"
                data-testid="task-note-mention-chip-remove"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("tasks.notes.removeMention", { name: name(m) })}
                onClick={() => setMentions((cur) => cur.filter((x) => x.id !== m.id))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
        {t("common.enterToSave")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="task-note-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid="task-note-mention"
          disabled={busy || peopleLoading}
          aria-expanded={pickerOpen}
          onClick={() => {
            caret.current = area.current?.selectionStart ?? body.length;
            setPickerOpen(true);
          }}
        >
          <AtSign />
          {t("tasks.notes.mention")}
        </Button>
        <div className="flex gap-2">
          {mode === "edit" && (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              data-testid="task-note-cancel"
              disabled={busy}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </Button>
          )}
          <Button
            type="submit"
            className="h-11"
            data-testid={mode === "new" ? "task-note-submit" : "task-note-save"}
            disabled={busy}
          >
            {busy ? t("common.saving") : mode === "new" ? t("tasks.notes.add") : t("common.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
