import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  CURRENT_PASSWORD_WRONG,
  changePassword,
  validateChangePassword,
  type ChangePasswordErrors,
} from "@/lib/change-password";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, PasswordInput } from "./PasswordInput";

/**
 * Profile > Change password (collapsed by default): current, new and confirm; the current password is checked before
 * the change, and other devices are signed out by default. Values are never logged or shown.
 */
export function ChangePassword() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [errors, setErrors] = useState<ChangePasswordErrors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const email = session?.user.email;

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
    setFormError("");
    setSignOutOthers(true);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");
    const found = validateChangePassword({ current, next, confirm });
    setErrors(found);
    if (Object.keys(found).length || !email) return;
    setBusy(true);
    try {
      await changePassword({ email, current, next, signOutOthers });
      toast.success(
        t(signOutOthers ? "profile.password.changedSignedOut" : "profile.password.changed"),
      );
      reset();
      setOpen(false);
    } catch (err) {
      if (err instanceof Error && err.message === CURRENT_PASSWORD_WRONG)
        setErrors({ current: "profile.password.errors.currentWrong" });
      else setFormError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof ChangePasswordErrors) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": `${id}-${name}-error` } : {};

  return (
    <section
      data-testid="profile-password"
      aria-labelledby={`${id}-title`}
      className="max-w-xl rounded-2xl border bg-card p-6 shadow-soft"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        <button
          type="button"
          data-testid="profile-password-toggle"
          aria-expanded={open}
          aria-controls={`${id}-form`}
          onClick={() => {
            if (open) reset();
            setOpen(!open);
          }}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-3">
            <KeyRound className="size-5 text-primary" aria-hidden />
            {t("profile.password.title")}
          </span>
          <ChevronDown
            className={cn("size-5 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </h2>
      {open && (
        <form id={`${id}-form`} onSubmit={submit} noValidate className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-current`}>{t("profile.password.current")}</Label>
            <PasswordInput
              id={`${id}-current`}
              data-testid="profile-password-current"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-11"
              {...field("current")}
            />
            {errors.current && (
              <p
                id={`${id}-current-error`}
                data-testid="profile-password-current-error"
                className="text-sm font-medium text-destructive"
              >
                {t(errors.current)}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-new`}>{t("profile.password.new")}</Label>
            <PasswordInput
              id={`${id}-new`}
              data-testid="profile-password-new"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="h-11"
              aria-describedby={errors.next ? `${id}-next-error` : `${id}-help`}
              aria-invalid={errors.next ? true : undefined}
            />
            <p id={`${id}-help`} className="text-sm text-muted-foreground">
              {t("auth.passwordHelp", { count: MIN_PASSWORD_LENGTH })}
            </p>
            {errors.next && (
              <p
                id={`${id}-next-error`}
                data-testid="profile-password-new-error"
                className="text-sm font-medium text-destructive"
              >
                {t(errors.next)}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-confirm`}>{t("profile.password.confirm")}</Label>
            <PasswordInput
              id={`${id}-confirm`}
              data-testid="profile-password-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11"
              {...field("confirm")}
            />
            {errors.confirm && (
              <p
                id={`${id}-confirm-error`}
                data-testid="profile-password-confirm-error"
                className="text-sm font-medium text-destructive"
              >
                {t(errors.confirm)}
              </p>
            )}
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={`${id}-others`}
              data-testid="profile-password-sign-out-others"
              checked={signOutOthers}
              onCheckedChange={(v) => setSignOutOthers(v === true)}
            />
            <Label htmlFor={`${id}-others`} className="font-normal">
              {t("profile.password.signOutOthers")}
            </Label>
          </div>
          {formError && (
            <p
              data-testid="profile-password-error"
              role="alert"
              className="text-sm font-medium text-destructive"
            >
              {formError}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              data-testid="profile-password-submit"
              className="h-11"
              disabled={busy}
            >
              {busy ? t("common.saving") : t("profile.password.submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="profile-password-cancel"
              className="h-11"
              disabled={busy}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
