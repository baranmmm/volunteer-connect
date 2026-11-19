import { useTranslation } from "react-i18next";
import { setLanguage, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const opts: { value: Lang; label: string; name: string }[] = [
    { value: "en", label: "EN", name: "English" },
    { value: "tr", label: "TR", name: "Türkçe" },
  ];
  return (
    <div role="group" aria-label={t("common.languageToggle")} className={cn("inline-flex items-center rounded-full border bg-card p-0.5 text-sm font-medium", className)}>
      {opts.map((o, i) => (
        <span key={o.value} className="flex items-center">
          {i > 0 && <span aria-hidden className="px-0.5 text-muted-foreground">|</span>}
          <button type="button" data-testid={`auth-language-toggle-${o.value}`} lang={o.value} aria-label={o.name} aria-pressed={i18n.language === o.value} onClick={() => setLanguage(o.value)}
            className={cn("min-h-9 min-w-10 rounded-full px-2.5", i18n.language === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        </span>
      ))}
    </div>
  );
}
