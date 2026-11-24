import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck } from "lucide-react";
import { useDashboardWork } from "@/lib/use-dashboard-work";
import { useNotificationCounts, useWorkMember } from "@/lib/use-work-notices";
import { bellBadge, useNotificationActions } from "@/lib/use-notification-actions";
import { NotificationEntries } from "@/components/app/NotificationsCard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The header bell: unread count, and the latest notices (grouped as on the old dashboard card) in a popover on
 * desktop or a full-height sheet on phones, with "Mark all as read" and "See all" (/notifications). Rendered once per
 * header (desktop top bar, mobile header); each header is visible at one breakpoint only. Followers have no notices
 * (nothing renders, no query runs); the app layout shows it only after the MFA and privacy gates.
 */
export function NotificationBell({ variant }: { variant: "popover" | "sheet" }) {
  const { t } = useTranslation();
  const member = useWorkMember();
  const [open, setOpen] = useState(false);
  const unread = useNotificationCounts().data?.total ?? 0;
  if (!member) return null;
  const trigger = (
    <button
      type="button"
      data-testid="header-notifications-bell"
      aria-label={t("notifications.bell", { count: unread })}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          data-testid="header-notifications-badge"
          data-count={unread}
          className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-[0.65rem] font-semibold leading-5 text-primary-foreground"
        >
          {bellBadge(unread)}
        </span>
      )}
    </button>
  );
  const close = () => setOpen(false);
  if (variant === "sheet")
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          data-testid="notifications-popover"
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetTitle className="sr-only">{t("notifications.title")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("notifications.panelDescription")}
          </SheetDescription>
          <NoticesPanel onClose={close} closeButton />
        </SheetContent>
      </Sheet>
    );
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        data-testid="notifications-popover"
        role="dialog"
        aria-label={t("notifications.title")}
        align="end"
        className="flex max-h-[min(36rem,calc(100vh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col p-0"
      >
        <NoticesPanel onClose={close} />
      </PopoverContent>
    </Popover>
  );
}

/** The panel inside the popover / sheet: title, Mark all as read, the grouped list and See all. */
function NoticesPanel({ onClose, closeButton }: { onClose: () => void; closeButton?: boolean }) {
  const { t } = useTranslation();
  const query = useDashboardWork();
  const { open, markAll, readDigest, busy } = useNotificationActions(onClose);
  const items = query.data?.notifications ?? [];
  const failed = query.isError || query.data?.notifications === null;
  const unread = items.some((n) => !n.read_at);
  let content: ReactNode;
  if (query.isLoading) content = <p className="p-4 text-muted-foreground">{t("common.loading")}</p>;
  else if (failed)
    content = (
      <div role="alert" className="space-y-2 p-4">
        <p className="text-destructive">{t("notifications.loadError")}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  else if (items.length === 0)
    content = (
      <p data-testid="notifications-empty" className="p-4 text-muted-foreground">
        {t("notifications.empty")}
      </p>
    );
  else content = <NotificationEntries items={items} onOpen={open} onExpandDigest={readDigest} />;
  return (
    <>
      <div
        className={cn(
          "flex min-h-14 flex-wrap items-center justify-between gap-2 border-b py-2 pl-4",
          closeButton ? "pr-12" : "pr-3",
        )}
      >
        <h2 className="text-base font-semibold">{t("notifications.title")}</h2>
        {unread && (
          <Button
            variant="outline"
            size="sm"
            data-testid="notifications-mark-all"
            disabled={busy}
            onClick={() => void markAll()}
          >
            <CheckCheck />
            {t("notifications.markAll")}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">{content}</div>
      <div className="border-t p-2">
        <Button asChild variant="ghost" className="w-full">
          <Link to="/notifications" data-testid="notifications-see-all" onClick={onClose}>
            {t("notifications.seeAll")}
          </Link>
        </Button>
      </div>
    </>
  );
}
