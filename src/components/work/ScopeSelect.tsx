import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { scopeKey, type WorkScopeOption } from "@/lib/work-scopes";

/**
 * Where a task or meeting is created: national, a region, or a branch, from the options the database returned for
 * the caller (list_my_work_scopes). Hidden when there is only one option.
 */
export function ScopeSelect({
  id,
  testId,
  options,
  value,
  onChange,
  disabled,
}: {
  id: string;
  testId: string;
  options: WorkScopeOption[];
  value: WorkScopeOption | null;
  onChange: (scope: WorkScopeOption) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const label = (o: WorkScopeOption) =>
    o.scope === "national"
      ? t("work.scope.national")
      : o.scope === "region"
        ? t("work.scope.regionNamed", { name: o.label ?? "" })
        : t("work.scope.branchNamed", { name: o.label ?? "" });
  if (options.length <= 1 && value)
    return (
      <p
        className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]"
        data-testid={`${testId}-fixed`}
        data-scope={scopeKey(value)}
      >
        {t("work.scope.label")}: {label(value)}
      </p>
    );
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{t("work.scope.label")}</Label>
      <select
        id={id}
        data-testid={testId}
        disabled={disabled}
        value={value ? scopeKey(value) : ""}
        onChange={(e) => {
          const next = options.find((o) => scopeKey(o) === e.target.value);
          if (next) onChange(next);
        }}
        className="h-11 w-full max-w-full rounded-xl border border-input bg-card px-3 text-base"
      >
        {options.map((o) => (
          <option key={scopeKey(o)} value={scopeKey(o)}>
            {label(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
