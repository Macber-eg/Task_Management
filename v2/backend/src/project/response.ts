import {
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../common/openapi";
import {
  boardColumnSchema,
  boardTaskSchema,
} from "./public-board/board-schema";

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    backgroundVersion: z.string().nullable(),
    slug: z.string().openapi({
      description: "Short prefix used in task identifiers, e.g. KAN-12.",
    }),
    icon: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
    isPublic: z.boolean().nullable().openapi({
      description:
        "When true the project's board is readable without signing in, via /api/public-project/{id}.",
    }),
    archivedAt: nullableResponseTimestamp.openapi({
      description:
        "Non-null once archived; archived projects are hidden by default.",
    }),
    position: z.number().openapi({ description: "Sidebar order, ascending." }),
    lastTaskNumber: z.number().openapi({
      description:
        "Highest task number issued in this project; the next task gets this plus one.",
    }),
    phasesEnabled: z.boolean().openapi({
      description: "When true, the project uses optional delivery phases.",
    }),
    sprintsEnabled: z.boolean().openapi({
      description: "When true, the project uses optional sprints.",
    }),
    startDate: nullableResponseTimestamp.openapi({
      description: "Optional planned start of the project.",
    }),
    endDate: nullableResponseTimestamp.openapi({
      description: "Optional planned end of the project.",
    }),
  })
  .openapi("Project");

export const projectStatisticsSchema = z
  .object({
    completionPercentage: z.number(),
    totalTasks: z.number(),
    dueDate: nullableResponseTimestamp.openapi({
      description: "The soonest due date among the project's open tasks.",
    }),
  })
  .openapi("ProjectStatistics");

export const projectListItemSchema = projectSchema
  .extend({
    statistics: projectStatisticsSchema,
    // Legacy, always empty. Fetch the board via GET /task/tasks/{id}.
    archivedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    plannedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    columns: z
      .array(boardColumnSchema)
      .openapi({ description: "Always empty." }),
  })
  .openapi("ProjectListItem");

export const projectListSchema = z.array(projectListItemSchema);

export const movedProjectSchema = projectSchema
  .extend({ unassignedTaskCount: z.number() })
  .openapi("MovedProject");
