import { z } from "../common/openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const reportQuery = z.object({
  phaseId: z.string().optional(),
  sprintId: z.string().optional(),
});

export const timesheetQuery = z.object({
  workspaceId: z.string(),
  projectId: z.string().optional(),
  phaseId: z.string().optional(),
  sprintId: z.string().optional(),
  taskId: z.string().optional(),
  userId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const workloadQuery = z.object({
  workspaceId: z.string(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
  from: z.string(),
  to: z.string(),
});
