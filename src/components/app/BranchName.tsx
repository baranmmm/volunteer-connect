import { cn } from "@/lib/utils";

/**
 * A branch (or region) name on one line: long names are cut with "…" and the full name is in the tooltip, so they
 * never widen the page on phones. Its grid/flex ancestors need `min-w-0` (or `grid-cols-1`) to let it shrink.
 */
export function BranchName({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn("inline-block min-w-0 max-w-full truncate align-bottom", className)}
    >
      {name}
    </span>
  );
}
