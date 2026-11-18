import type { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";
import type Task from "@/types/task";

export type Project = Extract<
  InferResponseType<(typeof client)["project"][":id"]["$get"], 200>,
  { id: string }
>;

type TasksApiResponse = InferResponseType<
  (typeof client)["task"]["tasks"][":projectId"]["$get"],
  200
>;

type ProjectWithTasksRaw = TasksApiResponse["data"];

export type ProjectWithTasks = Omit<
  ProjectWithTasksRaw,
  "archivedTasks" | "backgroundVersion" | "columns" | "plannedTasks"
> & {
  // Older cache fixtures and persisted query data predate board backgrounds.
  backgroundVersion?: string | null;
  phasesEnabled?: boolean;
  sprintsEnabled?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  archivedTasks: Task[];
  columns: Array<
    Omit<ProjectWithTasksRaw["columns"][number], "tasks"> & {
      tasks: Task[];
    }
  >;
  plannedTasks: Task[];
};
