import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsible part of the event form. The content stays mounted while collapsed (values and file inputs keep their
 * state), only hidden. Test ids: `event-form-section-<name>` (data-open) and its trigger `event-form-section-<name>-toggle`
 * (aria-expanded).
 */
export function FormSection({
  name,
  title,
  open,
  onToggle,
  children,
}: {
  name: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = `event-form-section-${name}`;
  return (
    <section data-testid={id} data-open={open ? "true" : "false"} className="min-w-0 border-t pt-2">
      <button
        type="button"
        data-testid={`${id}-toggle`}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 break-words">{title}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div id={`${id}-content`} hidden={!open} className="min-w-0 space-y-4 pb-2 pt-2">
        {children}
      </div>
    </section>
  );
}
