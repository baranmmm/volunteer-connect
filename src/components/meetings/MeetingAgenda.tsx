import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { EventDialog } from "@/components/events/EventDialog";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { AgendaItem, MeetingDetail } from "@/lib/meetings";
import {
  addAgendaItem,
  addMeetingDecision,
  deleteAgendaItem,
  deleteMeetingDecision,
  moveAgendaItem,
  updateAgendaItem,
  updateMeetingDecision,
} from "@/lib/meetings.functions";

type Decision = AgendaItem["decisions"][number];

/** Agenda items with their decisions and the tasks created from them. Invitees see everything read-only. */
export function MeetingAgenda({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const editable = meeting.can_edit;
  const add = useServerFn(addAgendaItem),
    update = useServerFn(updateAgendaItem),
    remove = useServerFn(deleteAgendaItem),
    move = useServerFn(moveAgendaItem),
    addDecision = useServerFn(addMeetingDecision),
    updateDecision = useServerFn(updateMeetingDecision),
    removeDecision = useServerFn(deleteMeetingDecision);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [decisionFor, setDecisionFor] = useState<string | null>(null);
  const [editingDecision, setEditingDecision] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AgendaItem | null>(null);
  const [taskFor, setTaskFor] = useState<Decision | null>(null);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(translateError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const items = [...meeting.agenda].sort((a, b) => a.position - b.position);
  return (
    <section
      data-testid="meeting-agenda"
      aria-labelledby="meeting-agenda-title"
      className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id="meeting-agenda-title" className="text-xl font-semibold">
          {t("meetings.agenda.title")}
        </h2>
        {editable && !adding && (
          <Button
            data-testid="meeting-agenda-add"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => {
              setEditingItem(null);
              setAdding(true);
            }}
          >
            <Plus />
            {t("meetings.agenda.add")}
          </Button>
        )}
      </div>
      {editable && adding && (
        <ItemForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (title, notes) => {
            if (
              await run(
                () => add({ data: { meetingId: meeting.id, title, notes } }),
                t("meetings.agenda.added"),
              )
            )
              setAdding(false);
          }}
        />
      )}
      {items.length === 0 ? (
        <p data-testid="meeting-agenda-empty" className="mt-4 text-muted-foreground">
          {t("meetings.agenda.empty")}
        </p>
      ) : (
        <ol className="mt-4 grid min-w-0 grid-cols-1 gap-3">
          {items.map((item, index) => (
            <li
              key={item.id}
              data-testid="meeting-agenda-item"
              data-item-id={item.id}
              className="min-w-0 rounded-xl border p-3 sm:p-4"
            >
              {editingItem === item.id ? (
                <ItemForm
                  busy={busy}
                  title={item.title}
                  notes={item.notes ?? ""}
                  onCancel={() => setEditingItem(null)}
                  onSave={async (title, notes) => {
                    if (
                      await run(
                        () => update({ data: { id: item.id, title, notes } }),
                        t("meetings.agenda.updated"),
                      )
                    )
                      setEditingItem(null);
                  }}
                />
              ) : (
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 shrink-0 font-semibold text-muted-foreground" aria-hidden>
                    {index + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      data-testid="meeting-agenda-item-title"
                      className="font-semibold [overflow-wrap:anywhere]"
                    >
                      {item.title}
                    </h3>
                    {item.notes && (
                      <p
                        data-testid="meeting-agenda-item-notes"
                        className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {item.notes}
                      </p>
                    )}
                  </div>
                  {editable && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="meeting-agenda-up"
                        aria-label={t("meetings.agenda.moveUp")}
                        disabled={busy || index === 0}
                        onClick={() =>
                          void run(() => move({ data: { id: item.id, direction: -1 } }))
                        }
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="meeting-agenda-down"
                        aria-label={t("meetings.agenda.moveDown")}
                        disabled={busy || index === items.length - 1}
                        onClick={() =>
                          void run(() => move({ data: { id: item.id, direction: 1 } }))
                        }
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="meeting-agenda-edit"
                        aria-label={t("meetings.agenda.edit")}
                        disabled={busy}
                        onClick={() => {
                          setAdding(false);
                          setEditingItem(item.id);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        data-testid="meeting-agenda-delete"
                        aria-label={t("meetings.agenda.delete")}
                        disabled={busy}
                        onClick={() => setRemoving(item)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 min-w-0 border-t pt-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("meetings.decisions.title")}
                </h4>
                {item.decisions.length === 0 && decisionFor !== item.id && (
                  <p
                    data-testid="meeting-decisions-empty"
                    className="mt-1 text-sm text-muted-foreground"
                  >
                    {t("meetings.decisions.empty")}
                  </p>
                )}
                {item.decisions.length > 0 && (
                  <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2">
                    {item.decisions.map((d) => (
                      <li
                        key={d.id}
                        data-testid="meeting-decision"
                        data-decision-id={d.id}
                        className="min-w-0 rounded-lg bg-muted/50 p-3"
                      >
                        {editingDecision === d.id ? (
                          <DecisionForm
                            busy={busy}
                            text={d.text}
                            onCancel={() => setEditingDecision(null)}
                            onSave={async (text) => {
                              if (
                                await run(
                                  () => updateDecision({ data: { id: d.id, text } }),
                                  t("meetings.decisions.updated"),
                                )
                              )
                                setEditingDecision(null);
                            }}
                          />
                        ) : (
                          <div className="flex min-w-0 items-start gap-2">
                            <p
                              data-testid="meeting-decision-text-value"
                              className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]"
                            >
                              {d.text}
                            </p>
                            {editable && (
                              <div className="flex shrink-0 gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid="meeting-decision-edit"
                                  aria-label={t("meetings.decisions.edit")}
                                  disabled={busy}
                                  onClick={() => {
                                    setDecisionFor(null);
                                    setEditingDecision(d.id);
                                  }}
                                >
                                  <Pencil />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  data-testid="meeting-decision-delete"
                                  aria-label={t("meetings.decisions.delete")}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      () => removeDecision({ data: { id: d.id } }),
                                      t("meetings.decisions.deleted"),
                                    )
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                        {d.tasks.length > 0 && (
                          <ul
                            className="mt-2 grid min-w-0 grid-cols-1 gap-1"
                            aria-label={t("meetings.decisions.tasks")}
                          >
                            {d.tasks.map((task) => (
                              <li key={task.id} className="min-w-0">
                                <Link
                                  to="/tasks"
                                  search={{ task: task.id } as never}
                                  data-testid="meeting-decision-task"
                                  data-task-id={task.id}
                                  data-status={task.status}
                                  className="flex min-w-0 items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
                                >
                                  <ListChecks className="size-4 shrink-0" aria-hidden />
                                  <span className="min-w-0 flex-1 truncate" title={task.title}>
                                    {task.title}
                                  </span>
                                  <Badge variant="outline" className="shrink-0">
                                    {t(`meetings.taskStatus.${task.status}`)}
                                  </Badge>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                        {editable && editingDecision !== d.id && (
                          <Button
                            variant="link"
                            className="mt-1 h-auto min-h-11 px-0"
                            data-testid="meeting-decision-create-task"
                            disabled={busy}
                            onClick={() => setTaskFor(d)}
                          >
                            <Plus />
                            {t("meetings.decisions.createTask")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {editable &&
                  (decisionFor === item.id ? (
                    <div className="mt-2">
                      <DecisionForm
                        busy={busy}
                        onCancel={() => setDecisionFor(null)}
                        onSave={async (text) => {
                          if (
                            await run(
                              () => addDecision({ data: { itemId: item.id, text } }),
                              t("meetings.decisions.added"),
                            )
                          )
                            setDecisionFor(null);
                        }}
                      />
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-10"
                      data-testid="meeting-decision-add"
                      disabled={busy}
                      onClick={() => {
                        setEditingDecision(null);
                        setDecisionFor(item.id);
                      }}
                    >
                      <Plus />
                      {t("meetings.decisions.add")}
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ol>
      )}
      <EventDialog
        open={!!removing}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title={t("meetings.agenda.deleteTitle")}
        testId="meeting-agenda-delete-dialog"
      >
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {t("meetings.agenda.deleteText", { title: removing?.title ?? "" })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            data-testid="meeting-agenda-delete-cancel"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            data-testid="meeting-agenda-delete-confirm"
            disabled={busy}
            onClick={async () => {
              const item = removing;
              if (
                item &&
                (await run(() => remove({ data: { id: item.id } }), t("meetings.agenda.deleted")))
              )
                setRemoving(null);
            }}
          >
            <Trash2 />
            {t("meetings.agenda.delete")}
          </Button>
        </div>
      </EventDialog>
      {taskFor && (
        <TaskFormDialog
          open
          onClose={() => setTaskFor(null)}
          initial={{
            scope: meeting.scope,
            branch_id: meeting.branch_id,
            region_id: meeting.region_id,
            title: taskFor.text.slice(0, 200),
            decision_id: taskFor.id,
          }}
          onSaved={() => {
            setTaskFor(null);
            void qc.invalidateQueries({ queryKey: ["meeting", meeting.id] });
          }}
        />
      )}
    </section>
  );
}

function ItemForm({
  busy,
  title: title0 = "",
  notes: notes0 = "",
  onSave,
  onCancel,
}: {
  busy: boolean;
  title?: string;
  notes?: string;
  onSave: (title: string, notes: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(title0),
    [notes, setNotes] = useState(notes0),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      noValidate
      data-testid="meeting-agenda-form"
      className="mt-3 min-w-0 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setInvalid(true);
        void onSave(title.trim(), notes.trim() || null);
      }}
    >
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="meeting-agenda-title">{t("meetings.agenda.itemTitle")} *</Label>
        <Input
          id="meeting-agenda-title"
          data-testid="meeting-agenda-title"
          value={title}
          maxLength={200}
          aria-invalid={invalid}
          aria-describedby={invalid ? "meeting-agenda-title-error" : undefined}
          disabled={busy}
          onChange={(e) => {
            setTitle(e.target.value);
            setInvalid(false);
          }}
          className="h-11 min-w-0"
        />
        {invalid && (
          <p id="meeting-agenda-title-error" role="alert" className="text-sm text-destructive">
            {t("meetings.agenda.titleRequired")}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="meeting-agenda-notes">{t("meetings.agenda.notes")}</Label>
        <Textarea
          id="meeting-agenda-notes"
          data-testid="meeting-agenda-notes"
          value={notes}
          maxLength={5000}
          rows={3}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          data-testid="meeting-agenda-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" data-testid="meeting-agenda-save" disabled={busy}>
          {busy ? t("common.saving") : t("meetings.agenda.save")}
        </Button>
      </div>
    </form>
  );
}

function DecisionForm({
  busy,
  text: text0 = "",
  onSave,
  onCancel,
}: {
  busy: boolean;
  text?: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(text0),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      noValidate
      data-testid="meeting-decision-form"
      className="min-w-0 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return setInvalid(true);
        void onSave(text.trim());
      }}
    >
      <Label htmlFor="meeting-decision-text">{t("meetings.decisions.text")} *</Label>
      <Textarea
        id="meeting-decision-text"
        data-testid="meeting-decision-text"
        value={text}
        maxLength={2000}
        rows={2}
        aria-invalid={invalid}
        aria-describedby={invalid ? "meeting-decision-text-error" : undefined}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
      />
      {invalid && (
        <p id="meeting-decision-text-error" role="alert" className="text-sm text-destructive">
          {t("meetings.decisions.textRequired")}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          data-testid="meeting-decision-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" data-testid="meeting-decision-save" disabled={busy}>
          {busy ? t("common.saving") : t("meetings.decisions.save")}
        </Button>
      </div>
    </form>
  );
}
