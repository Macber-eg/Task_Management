import {
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../common/openapi";

// The board shapes the task routes also return. Same component names, so the
// OpenAPI document keeps one definition of each.

const priorityDescription = "One of: no-priority, low, medium, high, urgent.";

const taskLabelSchema = z
  .object({ id: z.string(), name: z.string(), color: z.string() })
  .openapi("TaskLabel");

const taskExternalLinkSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    integrationId: z.string().nullable(),
    resourceType: z.string(),
    externalId: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "Provider-specific payload, already parsed from the stored JSON string.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("TaskExternalLink");

export const boardTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    number: z.number().nullable(),
    description: z.string().nullable(),
    descriptionDeferred: z.boolean().optional().openapi({
      description:
        "True when the list omits a large description; load the task detail or description pages to read it. Do not replace stored text with this null summary.",
    }),
    status: z.string(),
    priority: z.string().openapi({ description: priorityDescription }),
    startDate: nullableResponseTimestamp,
    dueDate: nullableResponseTimestamp,
    position: z.number().nullable(),
    createdAt: responseTimestamp,
    estimatedMinutes: z.number().int().nullable().optional(),
    userId: z.string().nullable(),
    assigneeName: z.string().nullable(),
    assigneeId: z.string().nullable(),
    assigneeImage: z.string().nullable(),
    projectId: z.string(),
    phaseId: z.string().nullable().optional(),
    sprintId: z.string().nullable().optional(),
    subtaskCounts: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .openapi({
        description:
          "Direct subtasks in the workspace; completed means a final column in the child project. Public boards count only children in public projects.",
      }),
    labels: z.array(taskLabelSchema),
    externalLinks: z.array(taskExternalLinkSchema),
  })
  .openapi("BoardTask");

export const boardColumnSchema = z
  .object({
    id: z.string().openapi({ description: "The column slug, same as `slug`." }),
    slug: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    isFinal: z.boolean(),
    position: z.number().optional(),
    tasks: z.array(boardTaskSchema),
  })
  .openapi("BoardColumn");

export const boardSchema = z
  .object({
    data: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        icon: z.string().nullable(),
        description: z.string().nullable(),
        descriptionDeferred: z.boolean().optional().openapi({
          description:
            "True when a project description above 64 KiB is omitted; use project detail or public project description pages for full text.",
        }),
        isPublic: z.boolean().nullable(),
        workspaceId: z.string(),
        backgroundVersion: z.string().nullable(),
        phasesEnabled: z.boolean().optional(),
        sprintsEnabled: z.boolean().optional(),
        startDate: nullableResponseTimestamp.optional(),
        endDate: nullableResponseTimestamp.optional(),
        columns: z.array(boardColumnSchema),
        archivedTasks: z.array(boardTaskSchema),
        plannedTasks: z.array(boardTaskSchema),
      })
      .openapi("Board"),
    pagination: z
      .object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        totalPages: z.number(),
        relatedPage: z.number(),
        relatedPageSize: z.number(),
        relatedTotalPages: z.number(),
        relatedRevision: z.string().optional().openapi({
          description:
            "Public board labels and external links revision for this task page. Restart pagination if it changes during related-page continuations.",
        }),
        revision: z.string().optional().openapi({
          description:
            "Public board content, membership and ordering revision, including related records and visible subtask progress. Restart pagination if it changes between task or related pages.",
        }),
      })
      .openapi({
        description:
          "Always paginated: 50 tasks by default, at most 100 per page. Continue through totalPages to retrieve all tasks. For each task page, follow relatedPage through relatedTotalPages to retrieve all labels, external links and columns (100 related rows per kind per request, plus up to 100 columns needed to represent the tasks).",
      })
      .openapi("BoardPagination"),
  })
  .openapi("BoardResponse");
