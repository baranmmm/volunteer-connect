import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronDown, ListChecks } from "lucide-react";
import { linkedRows } from "@/lib/tasks";
import {
  fullCarryOver,
  toggleCarryDecision,
  type CarryOverChoice,
  type CarryOverItem,
} from "@/lib/meetings";
import { listMeetingCarryOver } from "@/lib/meetings.functions";
import { scopeKey, type WorkScopeOption } from "@/lib/work-scopes";
import { cn } from "@/lib/utils";
import { TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { formatDate } from "@/lib/i18n";

/**
 * Creating a meeting: optional carry-over from earlier meetings of the same place (list_meeting_carry_over). Collapsed,
 * and shown only when there is something to carry. Ticking an agenda item selects all its decisions; each can then be
 * unticked. The new meeting gets copies of the items and decisions (carry_over_agenda, after the meeting is created).
 * A ticked decision lists its open tasks read-only: they are never moved or copied, and show under the copy too. An
 * "@all" group is one entry.
 *
 * Test ids (prefix = testId): `-carry` (data-count), `-carry-toggle` (aria-expanded), `-carry-meeting`
 * (data-meeting-id), `-carry-item` (checkbox, data-item-id), `-carry-decision` (checkbox, data-decision-id),
 * `-carry-task` (read-only row, data-task-id or data-group-id).
 */
export function MeetingCarryOver({
  scope,
  value,
  onChange,
  disabled,
  testId,
}: {
  scope: WorkScopeOption | null;
  value: CarryOverChoice[];
  onChange: (value: CarryOverChoice[]) => void;
  disabled?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const fetchCarry = useServerFn(listMeetingCarryOver);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["meeting-carry-over", scope ? scopeKey(scope) : null],
    queryFn: () =>
      fetchCarry({
        data: { scope: scope!.scope, branchId: scope!.branch_id, regionId: scope!.region_id },
      }),
    enabled: !!scope,
    staleTime: 30000,
  });
  const meetings = query.data ?? [];
  const itemCount = meetings.reduce((n, m) => n + m.items.length, 0);
  if (!scope || itemCount === 0) return null;
  const chosen = (itemId: string) => value.find((c) => c.item_id === itemId);
  const setItem = (item: CarryOverItem, on: boolean) =>
    onChange(
      on
        ? [...value.filter((c) => c.item_id !== item.id), fullCarryOver(item)]
        : value.filter((c) => c.item_id !== item.id),
    );
  const update = (next: CarryOverChoice) =>
    onChange(value.map((c) => (c.item_id === next.item_id ? next : c)));
  const box = "mt-0.5 size-4 shrink-0";

  return (
    <div
      className="min-w-0 rounded-lg border"
      data-testid={`${testId}-carry`}
      data-count={itemCount}
    >
      <button
        type="button"
        data-testid={`${testId}-carry-toggle`}
        aria-expanded={open}
        aria-controls={`${testId}-carry-body`}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          {t("meetings.carry.toggle", { count: itemCount })}
          {value.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              {t("meetings.carry.chosen", { count: value.length })}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div id={`${testId}-carry-body`} hidden={!open} className="min-w-0 space-y-4 border-t p-3">
        {open && (
          <>
            <p className="text-sm text-muted-foreground">{t("meetings.carry.hint")}</p>
            {meetings.map((m) => (
              <fieldset
                key={m.meeting_id}
                className="min-w-0 space-y-2"
                data-testid={`${testId}-carry-meeting`}
                data-meeting-id={m.meeting_id}
              >
                <legend className="text-sm font-semibold [overflow-wrap:anywhere]">
                  {m.meeting_title}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {formatDate(m.starts_at, { dateStyle: "medium", timeZone: "Europe/London" })}
                  </span>
                </legend>
                <ul className="min-w-0 space-y-2">
                  {m.items.map((item) => {
                    const choice = chosen(item.id);
                    return (
                      <li key={item.id} className="min-w-0 rounded-md border p-2">
                        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            className={box}
                            data-testid={`${testId}-carry-item`}
                            data-item-id={item.id}
                            checked={!!choice}
                            disabled={disabled}
                            onChange={(e) => setItem(item, e.target.checked)}
                          />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
                        </label>
                        {choice && item.decisions.length > 0 && (
                          <ul className="ml-6 mt-1 min-w-0 space-y-1">
                            {item.decisions.map((d) => {
                              const decisionOn = choice.decision_ids.includes(d.id);
                              return (
                                <li key={d.id} className="min-w-0">
                                  <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      className={box}
                                      data-testid={`${testId}-carry-decision`}
                                      data-decision-id={d.id}
                                      checked={decisionOn}
                                      disabled={disabled}
                                      onChange={(e) =>
                                        update(toggleCarryDecision(choice, d.id, e.target.checked))
                                      }
                                    />
                                    <span className="min-w-0 [overflow-wrap:anywhere]">
                                      {d.text}
                                    </span>
                                  </label>
                                  {decisionOn && d.tasks.length > 0 && (
                                    <ul
                                      className="ml-6 min-w-0 space-y-1"
                                      aria-label={t("meetings.carry.tasksShared")}
                                    >
                                      {linkedRows(d.tasks).map((row) => {
                                        const first =
                                          row.kind === "group" ? row.tasks[0]! : row.task;
                                        return (
                                          <li
                                            key={row.kind === "group" ? row.groupId : row.task.id}
                                            data-testid={`${testId}-carry-task`}
                                            data-task-id={
                                              row.kind === "task" ? row.task.id : undefined
                                            }
                                            data-group-id={
                                              row.kind === "group" ? row.groupId : undefined
                                            }
                                            className="flex min-h-9 min-w-0 items-center gap-2 text-sm text-muted-foreground"
                                          >
                                            <ListChecks className="size-4 shrink-0" aria-hidden />
                                            <span
                                              className="min-w-0 flex-1 truncate"
                                              title={first.title}
                                            >
                                              {first.title}
                                              {row.kind === "group" &&
                                                ` · ${t("tasks.groups.allMembers", { count: row.tasks.length })}`}
                                            </span>
                                            {row.kind === "task" && (
                                              <TaskStatusBadge
                                                status={row.task.status}
                                                className="rounded-full"
                                              />
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
