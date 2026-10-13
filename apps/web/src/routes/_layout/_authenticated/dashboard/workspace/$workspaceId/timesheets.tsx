import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import TimesheetsPage from "@/components/time/timesheets-page";

type TimesheetsSearch = {
  projectId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/timesheets",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): TimesheetsSearch => ({
    projectId:
      typeof search.projectId === "string" ? search.projectId : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { projectId } = Route.useSearch();

  return (
    <>
      <PageTitle title={t("tasks:time.timesheetsTitle")} />
      <WorkspaceLayout title={t("tasks:time.timesheetsTitle")}>
        <TimesheetsPage
          workspaceId={workspaceId}
          initialProjectId={projectId}
        />
      </WorkspaceLayout>
    </>
  );
}
