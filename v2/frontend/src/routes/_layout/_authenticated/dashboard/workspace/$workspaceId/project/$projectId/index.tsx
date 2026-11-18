import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import ProjectOverviewPage from "@/components/project/project-overview-page";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/",
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
        title={t("projectHome:pageTitle", { name: project?.name ?? "" })}
      />
      <ProjectLayout
        workspaceId={workspaceId}
        projectId={projectId}
        activeView="home"
      >
        <ProjectOverviewPage workspaceId={workspaceId} projectId={projectId} />
      </ProjectLayout>
    </>
  );
}
