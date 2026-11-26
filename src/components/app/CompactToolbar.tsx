// Phone toolbars (< 640px, useNarrowScreen): one slim sticky header row (title, view switch as icon buttons, a
// "Filters" button with the number of non-default settings), the settings in a bottom sheet (vaul Drawer: focus trap,
// Escape and swipe down close it, focus returns to the Filters button) and the page's main action as a floating +
// button above the bottom navigation. Used by /tasks and /calendar; wider screens keep their full toolbars.
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RotateCcw, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

/**
 * The slim header row, sticky below the app's top bar (`--app-header-h`, set by the member shell). Test id:
 * `${testId}` (the row) and `${testId}-title`.
 */
export function CompactHeader({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <header
      data-testid={testId}
      className="sticky top-[var(--app-header-h,0px)] z-20 -mx-4 -mt-4 flex min-w-0 items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur"
    >
      <h1 data-testid={`${testId}-title`} className="min-w-0 flex-1 truncate text-xl font-bold">
        {title}
      </h1>
      {children}
    </header>
  );
}

export type ViewOption<V extends string> = {
  value: V;
  icon: LucideIcon;
  label: string;
  testId: string;
};

/** The view switch as 44px icon buttons (aria-label, aria-pressed on the current view). */
export function IconViewSwitch<V extends string>({
  label,
  testId,
  options,
  value,
  onChange,
}: {
  label: string;
  testId?: string;
  options: ViewOption<V>[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex shrink-0">
      {options.map(({ value: v, icon: Icon, label: text, testId: id }) => (
        <Button
          key={v}
          type="button"
          data-testid={id}
          variant={value === v ? "secondary" : "ghost"}
          aria-pressed={value === v}
          aria-label={text}
          title={text}
          className="size-11 p-0 [&_svg]:size-5"
          onClick={() => onChange(v)}
        >
          <Icon aria-hidden />
        </Button>
      ))}
    </div>
  );
}

/**
 * The Filters button and its bottom sheet. Test ids (prefix = testId): `${testId}-button` (data-count; its name says
 * how many settings are active), `${testId}-badge`, `${testId}-sheet`, `${testId}-reset` and `${testId}-done`.
 */
export function FiltersSheet({
  testId,
  count,
  open,
  onOpenChange,
  onReset,
  children,
}: {
  testId: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const label = count ? t("toolbar.filtersActive", { count }) : t("toolbar.filters");
  const content = useRef<HTMLDivElement>(null);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-testid={`${testId}-button`}
          data-count={count}
          aria-label={label}
          className="relative h-11 min-w-11 shrink-0 px-3 [&_svg]:size-5"
        >
          <SlidersHorizontal aria-hidden />
          <span aria-hidden className="hidden min-[375px]:inline">
            {t("toolbar.filters")}
          </span>
          {count > 0 && (
            <span
              aria-hidden
              data-testid={`${testId}-badge`}
              className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-primary px-1.5 text-center text-[0.7rem] font-semibold leading-5 text-primary-foreground"
            >
              {count}
            </span>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        ref={content}
        data-testid={`${testId}-sheet`}
        aria-describedby={undefined}
        // Focus moves into the sheet itself (its title is read first, nothing scrolls); vaul would leave it outside.
        onOpenAutoFocus={() => content.current?.focus({ preventScroll: true })}
        className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]"
      >
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle>{t("toolbar.filters")}</DrawerTitle>
        </DrawerHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-2">{children}</div>
        <DrawerFooter className="flex-row gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            data-testid={`${testId}-reset`}
            className="h-11 flex-1"
            onClick={onReset}
          >
            <RotateCcw aria-hidden />
            {t("toolbar.reset")}
          </Button>
          <DrawerClose asChild>
            <Button type="button" data-testid={`${testId}-done`} className="h-11 flex-1">
              {t("toolbar.done")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** A labelled row inside the sheet (a select's label above it, full width). */
export function SheetField({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 space-y-1 [&_select]:w-full", className)}>{children}</div>;
}

/**
 * The page's main action as a round + button, bottom right above the bottom navigation and the safe area
 * (data-variant="fab"). The page adds bottom padding so it never covers the last row.
 */
export function FloatingActionButton({
  testId,
  label,
  onClick,
}: {
  testId: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      data-testid={testId}
      data-variant="fab"
      aria-label={label}
      title={label}
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 size-14 rounded-full p-0 shadow-lg [&_svg]:size-6"
      onClick={onClick}
    >
      <Plus aria-hidden />
    </Button>
  );
}

/** Bottom padding for a page with a floating action button (its height and gap above the bottom navigation). */
export const FAB_CLEARANCE = "pb-20";
