import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { assigneeLabel, type AssigneePerson } from "@/lib/assignee-label";
import { cn } from "@/lib/utils";

/**
 * Who a task is assigned to, on rows and cards: the first assignee's full name (phones: "First L."), "You" for the
 * signed-in user, and "+N" for the others. The full list is in the tooltip and is what screen readers hear (the
 * visible short text is hidden from them). Renders nothing without assignees.
 */
export function AssigneeNames({
  people,
  testId,
  className,
}: {
  people: readonly AssigneePerson[];
  testId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const label = assigneeLabel(people, {
    meId: session?.user.id,
    you: t("tasks.assigneeNames.you"),
    formerMember: t("common.formerMember"),
  });
  if (!label) return null;
  const all = label.names.join(", ");
  return (
    <span
      data-testid={testId}
      data-count={people.length}
      data-you={label.you}
      title={all}
      className={cn(
        "inline-flex min-w-0 shrink items-center gap-1 whitespace-nowrap text-xs text-muted-foreground dark:text-inherit",
        className,
      )}
    >
      <span
        aria-hidden
        data-testid={`${testId}-full`}
        className="hidden min-w-0 max-w-[10rem] truncate md:inline"
      >
        {label.full}
      </span>
      <span
        aria-hidden
        data-testid={`${testId}-short`}
        className="min-w-0 max-w-[6rem] truncate md:hidden"
      >
        {label.short}
      </span>
      {label.more > 0 && (
        <span
          aria-hidden
          data-testid={`${testId}-more`}
          className="shrink-0 rounded-full bg-muted px-1.5 font-semibold text-foreground"
        >
          +{label.more}
        </span>
      )}
      <span className="sr-only">{t("tasks.assigneeNames.label", { names: all })}</span>
    </span>
  );
}
