import type {
  ImportCounts,
  ImportRunProject,
} from "../database/entities/types/import-run-project";

export type {
  ImportCounts,
  ImportRunProject,
  ImportRunProjectStatus,
} from "../database/entities/types/import-run-project";

export const IMPORT_RUN_STATUSES = ["running", "completed", "failed"] as const;

export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const IMPORT_RUN_PROJECT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export const EMPTY_IMPORT_COUNTS: ImportCounts = {
  columns: 0,
  tasks: 0,
  labels: 0,
  comments: 0,
  assignees: 0,
  relations: 0,
};

export function pendingRunProject(
  sourceId: string,
  name: string,
): ImportRunProject {
  return {
    sourceId,
    name,
    status: "pending",
    projectId: null,
    projectSlug: null,
    counts: { ...EMPTY_IMPORT_COUNTS },
    warnings: [],
    error: null,
  };
}

export function failUnfinishedProjects(
  projects: ImportRunProject[],
  error: string,
): ImportRunProject[] {
  return projects.map((project) =>
    project.status === "pending" || project.status === "running"
      ? { ...project, status: "failed", error }
      : project,
  );
}
