// "Install app": the dashboard banner and the menu item (desktop sidebar, mobile "More" sheet). Chrome / Edge show the
// browser's own prompt; Safari and the browser-menu paths open a sheet with steps. Signed-in pages only.
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, PlusSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useInstallApp } from "@/lib/install-app-store";
import type { InstallSheetVariant } from "@/lib/install-app";
import { toast } from "@/lib/toast";

/** The trigger's click handler and the instruction sheet it opens (focus returns to the trigger on close). */
function useInstallTrigger() {
  const install = useInstallApp();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onClick = () => {
    if (install.mode === "prompt") void install.prompt();
    else if (install.mode) setOpen(true);
  };
  const sheet =
    install.mode && install.mode !== "prompt" ? (
      <InstallSheet
        variant={install.mode}
        open={open}
        onOpenChange={setOpen}
        returnFocus={() => triggerRef.current?.focus()}
      />
    ) : null;
  return { install, onClick, triggerRef, sheet };
}

/** Dismissible banner at the top of the dashboard; never shown again on this device once dismissed or installed. */
export function InstallAppBanner() {
  const { t } = useTranslation();
  const { install, onClick, triggerRef, sheet } = useInstallTrigger();
  if (!install.showBanner) return null;
  return (
    <section
      data-testid="install-app-banner"
      data-mode={install.mode ?? undefined}
      aria-labelledby="install-app-banner-title"
      className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4 shadow-soft sm:flex-nowrap"
    >
      <Download className="h-6 w-6 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="install-app-banner-title" className="font-semibold">
          {t("installApp.bannerTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("installApp.bannerText")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          ref={triggerRef}
          data-testid="install-app-button"
          className="h-11 rounded-xl"
          onClick={onClick}
        >
          {t("installApp.button")}
        </Button>
        <Button
          data-testid="install-app-banner-dismiss"
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-xl"
          aria-label={t("installApp.dismiss")}
          onClick={install.dismissBanner}
        >
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      {sheet}
    </section>
  );
}

/** The permanent menu item (`nav-install-app`), shown whenever this browser can install the app. */
export function InstallAppNavItem({ className }: { className: string }) {
  const { t } = useTranslation();
  const { install, onClick, triggerRef, sheet } = useInstallTrigger();
  if (!install.showMenuItem) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="nav-install-app"
        data-mode={install.mode ?? undefined}
        onClick={onClick}
        className={className}
      >
        <Download className="h-5 w-5" aria-hidden /> {t("installApp.button")}
      </button>
      {sheet}
    </>
  );
}

/** Safari's Share icon (a box with an arrow pointing up), as on the iPhone / iPad toolbar. */
function ShareIcon() {
  const { t } = useTranslation();
  return (
    <svg
      data-testid="install-app-share-icon"
      role="img"
      aria-label={t("installApp.shareIcon")}
      viewBox="0 0 24 24"
      className="inline-block h-6 w-6 align-text-bottom text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

const STEPS: Record<InstallSheetVariant, string[]> = {
  "ios-safari": ["iosSafari.step1", "iosSafari.step2", "iosSafari.step3"],
  "ios-other": ["iosOther.step1", "iosOther.step2", "iosOther.step3"],
  "android-menu": ["androidMenu.step1", "androidMenu.step2"],
  "mac-safari": ["macSafari.step1", "macSafari.step2"],
};
const INTRO: Record<InstallSheetVariant, string> = {
  "ios-safari": "iosSafari.intro",
  "ios-other": "iosOther.intro",
  "android-menu": "androidMenu.intro",
  "mac-safari": "macSafari.intro",
};

function InstallSheet({
  variant,
  open,
  onOpenChange,
  returnFocus,
}: {
  variant: InstallSheetVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const { t } = useTranslation();
  const icon = (step: string): ReactNode =>
    step === "iosSafari.step1" || step === "iosOther.step3" ? (
      <ShareIcon />
    ) : step === "iosSafari.step2" ? (
      <PlusSquare className="inline-block h-5 w-5 align-text-bottom text-primary" aria-hidden />
    ) : null;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + "/dashboard");
      toast.success(t("installApp.linkCopied"));
    } catch {
      toast.error(t("installApp.linkCopyFailed"));
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="install-app-sheet"
        data-variant={variant}
        className="mx-auto max-w-lg rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        // Radix returns focus only to its own trigger; the banner button / menu item opens this sheet itself.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <SheetHeader>
          <SheetTitle>
            {t(variant === "ios-other" ? "installApp.openInSafariTitle" : "installApp.title")}
          </SheetTitle>
          <SheetDescription data-testid="install-app-sheet-intro">
            {t(`installApp.${INTRO[variant]}`)}
          </SheetDescription>
        </SheetHeader>
        <ol data-testid="install-app-steps" className="mt-4 space-y-3">
          {STEPS[variant].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary"
              >
                {i + 1}
              </span>
              <span className="pt-0.5">
                {t(`installApp.${step}`)} {icon(step)}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {variant === "ios-other" && (
            <Button
              data-testid="install-app-copy-link"
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => void copyLink()}
            >
              {t("installApp.copyLink")}
            </Button>
          )}
          <Button
            data-testid="install-app-sheet-close"
            className="h-11 rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            {t("installApp.done")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
