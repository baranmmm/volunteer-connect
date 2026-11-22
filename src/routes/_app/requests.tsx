import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { pageHead } from "@/components/app/head";
import { ManagerEventRequests } from "@/components/requests/ManagerEventRequests";

export const Route = createFileRoute("/_app/requests")({
  ssr: false,
  head: () => pageHead("Event requests", "Review event requests for your branch or region."),
  component: RequestsPage,
});

/** Reviewers only (branch managers and regional directors); members' own requests are on /my-requests. */
function RequestsPage() {
  const { t } = useTranslation();
  const { isManager } = useAuth();
  if (!isManager)
    return (
      <div role="alert" className="space-y-2">
        <h1 className="text-2xl font-bold">{t("userDetails.notAllowedTitle")}</h1>
        <p className="text-muted-foreground">{t("requests.reviewOnly")}</p>
      </div>
    );
  return (
    <div className="space-y-8">
      <h1 className="flex items-center gap-3 text-3xl font-bold">
        <Inbox className="size-7 text-primary" aria-hidden />
        {t("requests.title")}
      </h1>
      <ManagerEventRequests />
    </div>
  );
}
