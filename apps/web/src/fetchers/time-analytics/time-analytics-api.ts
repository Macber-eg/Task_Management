import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json() as Promise<T>;
}

export type ProjectTimeReport = {
  projectId: string;
  projectName: string;
  estimatedMinutes: number;
  actualSeconds: number;
  varianceMinutes: number;
  utilizationPercent: number | null;
  remainingMinutes: number;
  overEstimate: boolean;
  taskCount: number;
  completedTasks: number;
  inProgressTasks: number;
  tasksOverEstimate: number;
  phases: Array<{
    phaseId: string;
    name: string;
    estimatedMinutes: number;
    actualSeconds: number;
    utilizationPercent: number | null;
    taskCount: number;
  }>;
  sprints: Array<{
    sprintId: string;
    name: string;
    phaseId: string | null;
    estimatedMinutes: number;
    actualSeconds: number;
    utilizationPercent: number | null;
    taskCount: number;
  }>;
  tasks: Array<{
    taskId: string;
    title: string;
    number: number | null;
    estimatedMinutes: number;
    actualSeconds: number;
    overEstimate: boolean;
    utilizationPercent: number | null;
  }>;
};

export async function fetchProjectTimeReport(
  projectId: string,
  query?: { phaseId?: string; sprintId?: string },
) {
  const params = new URLSearchParams();
  if (query?.phaseId) params.set("phaseId", query.phaseId);
  if (query?.sprintId) params.set("sprintId", query.sprintId);
  const suffix = params.size ? `?${params.toString()}` : "";
  return parseJson<ProjectTimeReport>(
    await fetch(getApiUrl(`time-analytics/project/${projectId}${suffix}`), {
      credentials: "include",
    }),
  );
}

export type TimesheetRow = {
  id: string;
  taskId: string;
  userId: string | null;
  userName: string | null;
  description: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
  taskTitle: string;
  taskNumber: number | null;
  taskEstimatedMinutes: number | null;
  projectId: string;
  projectName: string;
  phaseId: string | null;
  phaseName: string | null;
  sprintId: string | null;
  sprintName: string | null;
  userAllocatedMinutes: number | null;
};

export type WorkloadRow = {
  userId: string;
  userName: string;
  rangeCapacityMinutes: number;
  plannedMinutes: number;
  actualSeconds: number;
  workloadPercent: number | null;
  overloadedMinutes: number;
  availableMinutes: number;
  overEstimate: boolean;
  utilizationPercent: number | null;
};

export async function fetchTimesheets(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return parseJson<TimesheetRow[]>(
    await fetch(getApiUrl(`time-analytics/timesheets?${params.toString()}`), {
      credentials: "include",
    }),
  );
}

export async function fetchWorkloadReport(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return parseJson<WorkloadRow[]>(
    await fetch(getApiUrl(`time-analytics/workload?${params.toString()}`), {
      credentials: "include",
    }),
  );
}
