import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BranchName } from "@/components/app/BranchName";
import { cn } from "@/lib/utils";
import type { Person } from "@/lib/tasks";

/**
 * Searchable multi-select for people (assignees, invitees): chosen people show as removable chips, the rest are found
 * by typing in a dropdown. The list comes from the database (who may be chosen in the scope).
 *
 * Test ids (prefix = testId): root `${testId}` (data-count), the opener `${testId}-open`, the search box
 * `${testId}-search`, options `${testId}-option` (data-user-id, aria-selected), chips `${testId}-chip` (data-user-id)
 * with `${testId}-chip-remove`, and `${testId}-empty` when nobody can be chosen.
 * `hideLabel` keeps the label for screen readers only (when a surrounding header already shows it).
 */
export function PeopleCombobox({
  testId,
  label,
  people,
  selected,
  onChange,
  disabled,
  loading,
  emptyText,
  placeholder,
  hideLabel,
}: {
  testId: string;
  label: string;
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  // Stable across renders, so a parent re-rendering (e.g. a clock tick) does not re-filter the open list.
  const filter = useCallback(
    (value: string, search: string) =>
      (byId.get(value)?.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ? 1 : 0,
    [byId],
  );
  const chosen = selected.map((id) => byId.get(id) ?? { id, full_name: null });
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const name = (p: Pick<Person, "full_name">) => p.full_name ?? t("common.formerMember");
  const labelId = `${testId}-label`;

  return (
    <div className="min-w-0 space-y-2" data-testid={testId} data-count={selected.length}>
      <div id={labelId} className={hideLabel ? "sr-only" : "text-sm font-medium"}>
        {label} <span className="text-muted-foreground">({selected.length})</span>
      </div>
      {chosen.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={label}>
          {chosen.map((p) => (
            <li
              key={p.id}
              data-testid={`${testId}-chip`}
              data-user-id={p.id}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-secondary py-0.5 pl-2.5 pr-1 text-sm"
            >
              <span className="min-w-0 truncate" title={name(p)}>
                {name(p)}
              </span>
              {!disabled && (
                <button
                  type="button"
                  data-testid={`${testId}-chip-remove`}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("work.people.remove", { name: name(p) })}
                  onClick={() => toggle(p.id)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
          {emptyText ?? t("work.people.none")}
        </p>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-labelledby={labelId}
              disabled={disabled}
              data-testid={`${testId}-open`}
              className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <span className="min-w-0 truncate">{placeholder ?? t("work.people.add")}</span>
              <ChevronsUpDown className="size-4 shrink-0" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(24rem,calc(100vw-2rem))] p-0"
            align="start"
            collisionPadding={16}
          >
            <Command filter={filter}>
              <CommandInput
                data-testid={`${testId}-search`}
                placeholder={t("work.people.search")}
                aria-label={t("work.people.search")}
              />
              <CommandList className="max-h-64">
                <CommandEmpty>{t("work.people.noMatch")}</CommandEmpty>
                <CommandGroup>
                  {people.map((p) => {
                    const on = selected.includes(p.id);
                    return (
                      <CommandItem
                        key={p.id}
                        value={p.id}
                        onSelect={() => toggle(p.id)}
                        data-testid={`${testId}-option`}
                        data-user-id={p.id}
                        aria-selected={on}
                        className="min-h-11 gap-3"
                      >
                        <Check
                          className={cn("size-4 shrink-0", on ? "opacity-100" : "opacity-0")}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" title={name(p)}>
                            {name(p)}
                          </span>
                          {(p.role || p.branch) && (
                            <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                              {p.role && (
                                <span className="shrink-0">{t(`common.roles.${p.role}`)}</span>
                              )}
                              {p.branch && (
                                <>
                                  <span aria-hidden>·</span>
                                  <BranchName name={p.branch} />
                                </>
                              )}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
