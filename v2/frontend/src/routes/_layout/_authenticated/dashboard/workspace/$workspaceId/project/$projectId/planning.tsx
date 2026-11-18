import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import ProjectPlanningPanel from "@/components/project/project-planning-panel";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/planning",
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
        title={t("tasks:planning.pageTitle", {
          name: project?.name ?? t("tasks:title"),
        })}
      />
      <ProjectLayout
        workspaceId={workspaceId}
        projectId={projectId}
        activeView="planning"
      >
        <ProjectPlanningPanel projectId={projectId} workspaceId={workspaceId} />
      </ProjectLayout>
    </>
  );
}
