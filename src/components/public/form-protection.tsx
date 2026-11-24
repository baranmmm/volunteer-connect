import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { getPublicFormConfig } from "@/lib/public-guest.functions";

// Shared by the signed-out forms (guest registration, "Get event updates"): the form config (Turnstile site key and
// the fill-time stamp), the honeypot field and the Turnstile widget.

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      language?: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Loads the Turnstile script once (only when a site key is configured). */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** The form config; the stamp is issued when the form is first shown. */
export function usePublicFormConfig() {
  const fetchConfig = useServerFn(getPublicFormConfig);
  return useQuery({
    queryKey: ["public-form-config"],
    queryFn: () => fetchConfig(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

/** Turnstile (explicit render). `resetSignal` changes after each submit: a token works only once. */
export function TurnstileWidget({
  siteKey,
  onToken,
  resetSignal,
  testId,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetSignal: number;
  testId: string;
}) {
  const { i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;
  const lang = i18n.language?.startsWith("tr") ? "tr" : "en";
  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return;
        widget.current = api.render(ref.current, {
          sitekey: siteKey,
          language: lang,
          callback: (token) => tokenRef.current(token),
          "expired-callback": () => tokenRef.current(null),
          "error-callback": () => tokenRef.current(null),
        });
      })
      .catch(() => tokenRef.current(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, lang]);
  useEffect(() => {
    if (resetSignal && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      tokenRef.current(null);
    }
  }, [resetSignal]);
  return <div ref={ref} data-testid={testId} className="min-h-[65px]" />;
}

/** A field people never see or fill (bots do). Hidden from screen readers and the tab order. */
export function Honeypot({
  value,
  onChange,
  testId,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  testId: string;
  id: string;
}) {
  const { t } = useTranslation();
  return (
    <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label htmlFor={id}>{t("guest.honeypot")}</label>
      <input
        id={id}
        data-testid={testId}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The server ignores submits sooner than 2 s after the form stamp was issued (bots). A very fast person (or the
 * browser's autofill) simply waits out the rest here instead of being dropped.
 */
export async function waitForMinFill(issuedAt: number) {
  const left = issuedAt + 2200 - Date.now();
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}
