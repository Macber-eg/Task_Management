import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import ProjectTimeAnalyticsPage from "@/components/project/project-time-analytics-page";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/time-analytics",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId, projectId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });

  return (
    <>
      <PageTitle
        title={t("tasks:time.analyticsTitle", {
          name: project?.name ?? "",
        })}
      />
      <ProjectLayout workspaceId={workspaceId} projectId={projectId}>
        <ProjectTimeAnalyticsPage
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </ProjectLayout>
    </>
  );
}
