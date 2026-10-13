import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { useGetPhases } from "@/hooks/queries/planning/use-get-phases";
import { formatPlanningRange } from "@/lib/planning-dates";

type DocumentSearch = {
  phaseId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/document",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DocumentSearch => ({
    phaseId: typeof search.phaseId === "string" ? search.phaseId : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId, projectId } = Route.useParams();
  const { phaseId } = Route.useSearch();
  const navigate = useNavigate();
  const { data: phases = [] } = useGetPhases(projectId, true);
  const doc = phases.find((phase) => phase.id === phaseId);

  return (
    <>
      <PageTitle title={doc?.name ?? t("tasks:planning.documentViewer")} />
      <ProjectLayout
        workspaceId={workspaceId}
        projectId={projectId}
        activeView="board"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-10">
          <div className="flex items-start gap-3">
            <FileText className="mt-1 size-8 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold">{doc?.name ?? "—"}</h1>
              {doc ? (
                <p className="text-sm text-muted-foreground">
                  {formatPlanningRange(doc.startDate, doc.endDate) ??
                    t("tasks:planning.noDates")}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("tasks:planning.documentPlaceholder")}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/planning",
                  params: { workspaceId, projectId },
                })
              }
            >
              {t("navigation:sidebar.planning")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                  params: { workspaceId, projectId },
                  search: phaseId ? { phaseId } : {},
                })
              }
            >
              {t("navigation:sidebar.backToBoard")}
            </Button>
          </div>
        </div>
      </ProjectLayout>
    </>
  );
}
