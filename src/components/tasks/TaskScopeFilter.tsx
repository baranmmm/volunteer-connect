import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Multi-select for the /tasks branch and region filters: a button opens a list of checkable options; nothing chosen
 * means "All". Test ids (prefix = testId): the opener `${testId}` (data-count, data-disabled/aria-disabled while it is
 * ignored), options `${testId}-option` (data-value, aria-checked) and `${testId}-all` (clears the choice).
 */
export function TaskScopeFilter({
  testId,
  label,
  options,
  selected,
  onChange,
  disabled,
  describedBy,
}: {
  testId: string;
  label: string;
  /** [value, visible label] */
  options: [string, string][];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labelId = `${testId}-label`;
  const names = options.filter(([v]) => selected.includes(v)).map(([, text]) => text);
  const summary =
    names.length === 0
      ? t("tasks.filters.all")
      : names.length <= 2
        ? names.join(", ")
        : t("tasks.filters.selectedCount", { count: names.length });
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="min-w-0 space-y-1">
      <div id={labelId} className="text-xs text-muted-foreground">
        {label}
      </div>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={testId}
            data-count={names.length}
            data-disabled={disabled ? "true" : undefined}
            aria-disabled={disabled || undefined}
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-haspopup="true"
            aria-expanded={open && !disabled}
            disabled={disabled}
            className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-56"
          >
            <span className="min-w-0 truncate">{summary}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(20rem,calc(100vw-2rem))] p-1"
          align="start"
          collisionPadding={16}
        >
          <div role="group" aria-labelledby={labelId} className="max-h-72 overflow-y-auto">
            <button
              type="button"
              data-testid={`${testId}-all`}
              role="checkbox"
              aria-checked={selected.length === 0}
              className={optionClass}
              onClick={() => onChange([])}
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  selected.length === 0 ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <span className="min-w-0 truncate">{t("tasks.filters.all")}</span>
            </button>
            {options.map(([value, text]) => {
              const on = selected.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  data-testid={`${testId}-option`}
                  data-value={value}
                  className={optionClass}
                  onClick={() => toggle(value)}
                >
                  <Check
                    className={cn("size-4 shrink-0", on ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate" title={text}>
                    {text}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const optionClass =
  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-sm px-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
