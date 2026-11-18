import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import WorkloadPage from "@/components/time/workload-page";

type WorkloadSearch = {
  projectId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/workload",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): WorkloadSearch => ({
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
      <PageTitle title={t("tasks:time.workloadTitle")} />
      <WorkspaceLayout title={t("tasks:time.workloadTitle")}>
        <WorkloadPage workspaceId={workspaceId} initialProjectId={projectId} />
      </WorkspaceLayout>
    </>
  );
}
