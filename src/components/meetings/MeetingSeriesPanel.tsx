import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";
import { TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { MeetingDetail } from "@/lib/meetings";
import { getMeetingSeriesTasks, setMeetingSeriesAgenda } from "@/lib/meetings.functions";
import {
  filterSeriesTasks,
  meetingDay,
  parseStandingAgenda,
  SERIES_TASK_FILTERS,
  type SeriesTaskFilter,
} from "./meeting-ui";

/** A recurring meeting's tasks (from every occurrence's decisions) and, for editors, its standing agenda items. */
export function MeetingSeriesPanel({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  const series = meeting.series;
  if (!series) return null;
  return (
    <section
      data-testid="meeting-series"
      data-series-id={series.id}
      aria-labelledby="meeting-series-title"
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
    >
      <h2 id="meeting-series-title" className="text-xl font-semibold">
        {t("meetings.series.title")}
      </h2>
      <SeriesTasks meetingId={meeting.id} />
      {meeting.can_edit && <StandingAgenda meeting={meeting} template={series.agenda_template} />}
    </section>
  );
}

function SeriesTasks({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const fetch = useServerFn(getMeetingSeriesTasks);
  const [filter, setFilter] = useState<SeriesTaskFilter>("open");
  const query = useQuery({
    queryKey: ["meeting-series-tasks", meetingId, uid],
    queryFn: () => fetch({ data: { id: meetingId } }),
    enabled: !!uid,
  });
  const shown = filterSeriesTasks(query.data ?? [], filter);
  return (
    <div data-testid="meeting-series-tasks" data-filter={filter} className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="size-5 shrink-0 text-primary" aria-hidden />
          {t("meetings.series.tasks")}
        </h3>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="meeting-series-tasks-filter" className="text-xs text-muted-foreground">
            {t("meetings.series.filter")}
          </Label>
          <select
            id="meeting-series-tasks-filter"
            data-testid="meeting-series-tasks-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as SeriesTaskFilter)}
            className="block h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:w-48"
          >
            {SERIES_TASK_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === "open" || value === "all"
                  ? t(`meetings.series.filters.${value}`)
                  : t(`meetings.taskStatus.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("meetings.loadError")}
        </p>
      ) : shown.length === 0 ? (
        <p data-testid="meeting-series-tasks-empty" className="text-sm text-muted-foreground">
          {t("meetings.series.tasksEmpty")}
        </p>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-2">
          {shown.map((task) => (
            <li key={task.id} className="min-w-0">
              <Link
                to="/tasks"
                search={{ task: task.id } as never}
                data-testid="meeting-series-task"
                data-task-id={task.id}
                data-status={task.status}
                data-meeting-id={task.meeting_id}
                className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm hover:border-primary"
              >
                <span className="min-w-0 flex-1 basis-40 truncate font-medium" title={task.title}>
                  {task.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {meetingDay(task.meeting_starts_at)}
                </span>
                <TaskStatusBadge status={task.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StandingAgenda({ meeting, template }: { meeting: MeetingDetail; template: string[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useServerFn(setMeetingSeriesAgenda);
  const [text, setText] = useState(template.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titles = parseStandingAgenda(text);
  return (
    <form
      noValidate
      data-testid="meeting-series-agenda"
      className="min-w-0 space-y-2 border-t pt-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await save({ data: { id: meeting.id, titles: titles.slice(0, 30) } });
          await Promise.all([
            qc.invalidateQueries({ queryKey: ["meeting"] }),
            qc.invalidateQueries({ queryKey: ["meetings"] }),
          ]);
          toast.success(t("meetings.series.agendaSaved"));
        } catch (err) {
          setError(translateError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label htmlFor="meeting-series-agenda-input" className="text-lg font-semibold">
        {t("meetings.series.agenda")}
      </Label>
      <p id="meeting-series-agenda-hint" className="text-sm text-muted-foreground">
        {t("meetings.series.agendaHint")}
      </p>
      <Textarea
        id="meeting-series-agenda-input"
        data-testid="meeting-series-agenda-input"
        aria-describedby="meeting-series-agenda-hint"
        value={text}
        rows={4}
        maxLength={6500}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      {titles.length > 30 && (
        <p role="alert" className="text-sm text-destructive">
          {t("meetings.series.agendaTooMany")}
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid="meeting-series-agenda-error"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="outline"
          className="h-11"
          data-testid="meeting-series-agenda-save"
          disabled={busy || titles.length > 30}
        >
          {busy ? t("common.saving") : t("meetings.series.agendaSave")}
        </Button>
      </div>
    </form>
  );
}
