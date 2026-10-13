import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const phaseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    parentId: z.string().nullable(),
    kind: z.string(),
    name: z.string(),
    position: z.number(),
    startDate: nullableResponseTimestamp,
    endDate: nullableResponseTimestamp,
    archivedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("ProjectPhase");

export const sprintSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    phaseId: z.string().nullable(),
    name: z.string(),
    goal: z.string().nullable(),
    status: z.string(),
    position: z.number(),
    startDate: nullableResponseTimestamp,
    endDate: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("ProjectSprint");

export const phaseListSchema = z.array(phaseSchema);
export const sprintListSchema = z.array(sprintSchema);
