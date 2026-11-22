import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { pageHead } from "@/components/app/head";
import { ManagerEventRequests } from "@/components/requests/ManagerEventRequests";
import { MyEventRequests } from "@/components/requests/MyEventRequests";
import { RequestEventButton } from "@/components/requests/RequestEventButton";
import { useCanRequestEvents } from "@/lib/use-event-requests";

export const Route = createFileRoute("/_app/requests")({
  ssr: false,
  head: () =>
    pageHead(
      "Event requests",
      "Request Dialogue Society events and review requests for your branch or region.",
    ),
  component: RequestsPage,
});

function RequestsPage() {
  const { t } = useTranslation();
  const { isManager, roles } = useAuth();
  const canRequest = useCanRequestEvents();
  const branchManager = roles.includes("branch_manager");
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <Inbox className="size-7 text-primary" aria-hidden />
            {isManager ? t("requests.title") : t("requests.myTitle")}
          </h1>
          {canRequest && (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t(branchManager ? "requests.openHintRegion" : "requests.openHint")}
            </p>
          )}
        </div>
        <RequestEventButton />
      </header>
      {isManager && <ManagerEventRequests />}
      {canRequest && <MyEventRequests />}
    </div>
  );
}
