export type ImportRunProjectStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type ImportCounts = {
  columns: number;
  tasks: number;
  labels: number;
  comments: number;
  assignees: number;
  relations: number;
};

export type ImportRunProject = {
  sourceId: string;
  name: string;
  status: ImportRunProjectStatus;
  projectId: string | null;
  projectSlug: string | null;
  counts: ImportCounts;
  warnings: string[];
  error: string | null;
};
