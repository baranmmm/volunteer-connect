import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { useAuth } from "@/lib/auth";
import { listMeetings } from "@/lib/meetings.functions";
import { useWorkScopes } from "@/components/work/use-work-scopes";

type When = "upcoming" | "past";

export const Route = createFileRoute("/_app/meetings")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { tab?: "past" } =>
    search["tab"] === "past" ? { tab: "past" } : {},
  head: () =>
    pageHead(
      "Meetings",
      "Dialogue Society meetings: agenda, decisions, files and follow-up tasks.",
    ),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const when: When = tab === "past" ? "past" : "upcoming";
  const { scopes } = useWorkScopes();
  const [creating, setCreating] = useState(false);
  const canCreate = scopes.length > 0;
  return (
    <div className="min-w-0 space-y-6">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t("navigation.meetings")}</h1>
        {canCreate && (
          <Button data-testid="meetings-new" className="h-11" onClick={() => setCreating(true)}>
            <Plus />
            {t("meetings.new")}
          </Button>
        )}
      </header>
      <Tabs
        value={when}
        onValueChange={(v) =>
          void navigate({
            to: "/meetings",
            search: v === "past" ? { tab: "past" } : {},
            replace: true,
          })
        }
        className="min-w-0 space-y-5"
      >
        <TabsList>
          <TabsTrigger value="upcoming" data-testid="meetings-tab-upcoming">
            {t("meetings.tabs.upcoming")}
          </TabsTrigger>
          <TabsTrigger value="past" data-testid="meetings-tab-past">
            {t("meetings.tabs.past")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="min-w-0">
          {when === "upcoming" && <MeetingList when="upcoming" />}
        </TabsContent>
        <TabsContent value="past" className="min-w-0">
          {when === "past" && <MeetingList when="past" />}
        </TabsContent>
      </Tabs>
      <MeetingFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSaved={(id) => void navigate({ to: "/meetings/$id", params: { id } })}
      />
    </div>
  );
}

function MeetingList({ when }: { when: When }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const fetch = useServerFn(listMeetings);
  const query = useQuery({
    queryKey: ["meetings", uid, when],
    queryFn: () => fetch({ data: { when } }),
    enabled: !!uid,
  });
  if (query.isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p className="text-destructive">{t("meetings.loadError")}</p>
        <Button variant="outline" data-testid="meetings-retry" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  const meetings = query.data ?? [];
  if (!meetings.length)
    return (
      <p
        data-testid="meetings-empty"
        data-when={when}
        className="rounded-lg border border-dashed p-6 text-center text-muted-foreground"
      >
        {when === "upcoming" ? t("meetings.emptyUpcoming") : t("meetings.emptyPast")}
      </p>
    );
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-3" data-testid="meetings-list" data-when={when}>
      {meetings.map((m) => (
        <li key={m.id} className="min-w-0">
          <MeetingCard meeting={m} />
        </li>
      ))}
    </ul>
  );
}
