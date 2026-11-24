import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { setLanguage, type Lang } from "@/lib/i18n";

const LANGS: { value: Lang; label: string; name: string }[] = [
  { value: "en", label: "EN", name: "English" },
  { value: "tr", label: "TR", name: "Türkçe" },
];

export function LandingFooter() {
  const { t, i18n } = useTranslation();
  return (
    <footer className="border-t border-ds-border bg-ds-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <img
            src="/brand/ds-logo-glow.svg"
            alt=""
            width={36}
            height={36}
            loading="lazy"
            className="h-9 w-9"
          />
          <p className="font-semibold text-ds-logo">
            {t("landing.footer.copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
        <nav
          aria-label={t("landing.footer.label")}
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          <Link
            to="/events"
            className="inline-flex min-h-11 items-center hover:text-ds-link hover:underline"
          >
            {t("landing.nav.events")}
          </Link>
          <Link
            to="/privacy"
            data-testid="landing-privacy-link"
            className="inline-flex min-h-11 items-center hover:text-ds-link hover:underline"
          >
            {t("landing.footer.privacy")}
          </Link>
          <Link
            to="/privacy/attendees"
            data-testid="landing-attendee-privacy-link"
            className="inline-flex min-h-11 items-center hover:text-ds-link hover:underline"
          >
            {t("landing.footer.attendeePrivacy")}
          </Link>
          <div
            role="group"
            aria-label={t("common.languageToggle")}
            className="flex items-center gap-1"
          >
            {LANGS.map((l) => (
              <button
                key={l.value}
                type="button"
                lang={l.value}
                data-testid={`landing-language-${l.value}`}
                aria-pressed={i18n.language === l.value}
                onClick={() => setLanguage(l.value)}
                className={`min-h-11 min-w-11 rounded-[3px] px-2 font-semibold ${i18n.language === l.value ? "bg-ds-slate text-ds-slate-fg" : "hover:text-ds-link"}`}
              >
                {l.label}
                <span className="sr-only"> {l.name}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </footer>
  );
}
