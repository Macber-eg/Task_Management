import { pagingNumber, z } from "../../common/openapi";

// Same filters as the task list route's query.
export const publicBoardQuery = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  // Number("abc") is NaN, which used to reach the limit/offset clause unchecked.
  page: pagingNumber(1, 1_000_000).optional(),
  relatedPage: pagingNumber(1, 1_000_000).optional(),
  limit: pagingNumber(1, 100).optional(),
  sortBy: z
    .enum(["createdAt", "priority", "dueDate", "position", "title", "number"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  phaseId: z.string().optional(),
  sprintId: z.string().optional(),
});

export type PublicBoardOptions = z.output<typeof publicBoardQuery>;
