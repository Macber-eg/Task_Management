import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useGetPhases } from "@/hooks/queries/planning/use-get-phases";
import { useGetSprints } from "@/hooks/queries/planning/use-get-sprints";
import useGetProject from "@/hooks/queries/project/use-get-project";

type ProjectHierarchyBreadcrumbProps = {
  workspaceId: string;
  projectId: string;
};

export default function ProjectHierarchyBreadcrumb({
  workspaceId,
  projectId,
}: ProjectHierarchyBreadcrumbProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    phaseId?: string;
    sprintId?: string;
    taskId?: string;
  };
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const phasesEnabled = !!project?.phasesEnabled;
  const sprintsEnabled = !!project?.sprintsEnabled;
  const { data: phases = [] } = useGetPhases(projectId, phasesEnabled);
  const { data: sprints = [] } = useGetSprints(projectId, sprintsEnabled);

  const crumbs = useMemo(() => {
    const items: {
      id: string;
      label: string;
      search: Record<string, string | undefined>;
    }[] = [];
    if (!project) return items;

    items.push({
      id: "project",
      label: project.name,
      search: {},
    });

    const phaseId = search.phaseId;
    const sprintId = search.sprintId;

    const resolvedPhaseId =
      phaseId ??
      (sprintId
        ? (sprints.find((item) => item.id === sprintId)?.phaseId ?? undefined)
        : undefined);

    if (resolvedPhaseId) {
      const phase = phases.find((item) => item.id === resolvedPhaseId);
      if (phase && (phase.kind ?? "folder") !== "document") {
        items.push({
          id: phase.id,
          label: phase.name,
          search: { phaseId: phase.id },
        });
      }
    }

    if (sprintId) {
      const sprint = sprints.find((item) => item.id === sprintId);
      if (sprint) {
        items.push({
          id: sprint.id,
          label: sprint.name,
          search: {
            phaseId: sprint.phaseId ?? resolvedPhaseId,
            sprintId: sprint.id,
          },
        });
      }
    }

    return items;
  }, [project, phases, sprints, search]);

  if (crumbs.length <= 1) return null;

  return (
    <Breadcrumb className="px-1 pb-2">
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <span key={crumb.id} className="contents">
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {index === crumbs.length - 1 ? (
                <span className="text-sm font-medium">{crumb.label}</span>
              ) : (
                <BreadcrumbLink
                  className="cursor-pointer text-sm"
                  onClick={() =>
                    navigate(
                      crumb.id === "project" &&
                        Object.keys(crumb.search).length === 0
                        ? {
                            to: "/dashboard/workspace/$workspaceId/project/$projectId",
                            params: { workspaceId, projectId },
                          }
                        : {
                            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                            params: { workspaceId, projectId },
                            search: crumb.search,
                          },
                    )
                  }
                >
                  {crumb.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
