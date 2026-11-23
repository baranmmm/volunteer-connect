import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { BranchName } from "@/components/app/BranchName";
import type { Person } from "@/lib/tasks";

/**
 * Pick several people (assignees, invitees) from the list the database allows for the scope. Each row exposes
 * data-user-id; long names are cut on one line with the full name in the tooltip.
 */
export function PersonPicker({
  testId,
  legend,
  people,
  selected,
  onChange,
  disabled,
  loading,
  emptyText,
}: {
  testId: string;
  legend: string;
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p) => (p.full_name ?? "").toLowerCase().includes(q)) : people;
  }, [people, search]);
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset className="min-w-0 space-y-2" data-testid={testId} aria-busy={loading || undefined}>
      <legend className="mb-1 text-sm font-medium">
        {legend} <span className="text-muted-foreground">({selected.length})</span>
      </legend>
      {people.length > 8 && (
        <Input
          type="search"
          data-testid={`${testId}-search`}
          aria-label={t("work.people.search")}
          placeholder={t("work.people.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10"
        />
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
          {emptyText ?? t("work.people.none")}
        </p>
      ) : (
        <ul className="max-h-56 min-w-0 space-y-1 overflow-y-auto rounded-xl border p-2">
          {shown.map((p) => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id} className="min-w-0">
                <label
                  className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted"
                  data-testid={`${testId}-option`}
                  data-user-id={p.id}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggle(p.id)}
                    data-testid={`${testId}-checkbox`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={p.full_name ?? ""}>
                      {p.full_name ?? t("common.formerMember")}
                    </span>
                    {(p.role || p.branch) && (
                      <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                        {p.role && <span className="shrink-0">{t(`common.roles.${p.role}`)}</span>}
                        {p.branch && (
                          <>
                            <span aria-hidden>·</span>
                            <BranchName name={p.branch} />
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
