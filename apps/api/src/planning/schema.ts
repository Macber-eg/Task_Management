import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const phaseParam = z.object({ id: z.string() });
export const sprintParam = z.object({ id: z.string() });

export const phaseKindSchema = z.enum(["folder", "document"]);

export const createPhaseBody = z.object({
  name: z.string().trim().min(1).max(128),
  parentId: z.string().nullable().optional(),
  kind: phaseKindSchema.optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const updatePhaseBody = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  parentId: z.string().nullable().optional(),
  kind: phaseKindSchema.optional(),
  position: z.number().int().min(0).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export const createSprintBody = z.object({
  name: z.string().trim().min(1).max(128),
  phaseId: z.string().nullable().optional().openapi({
    description:
      "Required when the project uses phases; ties the sprint to a phase.",
  }),
  goal: z.string().max(2000).nullable().optional(),
  status: z.enum(["planned", "active", "completed"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const reorderPhasesBody = z.object({
  phases: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int().min(0),
        parentId: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export const reorderSprintsBody = z.object({
  sprints: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int().min(0),
        phaseId: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export const updateSprintBody = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  phaseId: z.string().nullable().optional(),
  goal: z.string().max(2000).nullable().optional(),
  status: z.enum(["planned", "active", "completed"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});
