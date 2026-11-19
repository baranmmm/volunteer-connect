import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{t(titleKey)}</h1>
      <div className="rounded-2xl border bg-card p-10 text-center shadow-soft">
        <Sparkles className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold">{t("common.comingSoon")}</h2>
        <p className="mt-2 text-muted-foreground">{t("common.comingSoonText")}</p>
      </div>
    </div>
  );
}
