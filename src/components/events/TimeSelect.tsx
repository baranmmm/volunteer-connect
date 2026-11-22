import { useRef, useState, type FocusEvent } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_OPEN_TIME, QUARTER_HOURS, timeOptions } from "@/lib/time-options";

/**
 * Quarter-hour time picker. Type to jump ("18" → 18:00); with no value the list opens at 18:00.
 * Off-grid times it has shown (an existing event at 21:51) stay in the list, so they are never lost.
 */
export function TimeSelect({
  id,
  testId,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  label,
  placeholder,
}: {
  id: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
  label: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const seen = useRef(new Set<string>());
  if (value && !QUARTER_HOURS.includes(value)) seen.current.add(value);
  const options = timeOptions(seen.current);
  const defaultItem = useRef<HTMLDivElement>(null);
  // Radix moves focus into the list (to 00:00) once it is positioned. With no value, every such focus is sent
  // to 18:00 until the user types or moves the pointer, so the arrow keys and the scroll start there. No timers.
  const interacted = useRef(false);
  const onOpenChange = (next: boolean) => {
    interacted.current = false;
    setOpen(next);
  };
  const onFocusCapture = (e: FocusEvent) => {
    const item = defaultItem.current;
    if (value || interacted.current || !item || e.target === item) return;
    item.focus();
    item.scrollIntoView({ block: "center" });
  };
  const onInteract = () => {
    interacted.current = true;
  };
  return (
    <Select
      value={value}
      onValueChange={onChange}
      open={open}
      onOpenChange={onOpenChange}
      disabled={!!disabled}
    >
      <SelectTrigger
        id={id}
        data-testid={testId}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className="h-11 min-w-0 tabular-nums"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        onFocusCapture={onFocusCapture}
        onKeyDownCapture={onInteract}
        onPointerMoveCapture={onInteract}
        className="max-h-[min(18rem,var(--radix-select-content-available-height))]"
      >
        {options.map((time) => (
          <SelectItem
            key={time}
            value={time}
            data-testid={`${testId}-option-${time}`}
            className="tabular-nums"
            {...(time === DEFAULT_OPEN_TIME ? { ref: defaultItem } : {})}
          >
            {time}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
