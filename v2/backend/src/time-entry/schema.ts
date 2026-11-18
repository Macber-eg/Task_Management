import { z } from "../common/openapi";
import { isIsoTimestamp } from "./iso-timestamp";

const timestamp = z
  .string()
  .refine(isIsoTimestamp, "Expected an ISO 8601 timestamp")
  .openapi({ format: "date-time", example: "2026-01-31T09:00:00Z" });

export const taskIdParam = z.object({ taskId: z.string() });

export const timeEntryParam = z.object({ id: z.string() });

export const createTimeEntryBody = z.object({
  taskId: z.string(),
  startTime: timestamp,
  endTime: timestamp.optional().openapi({
    description: "Omit to start an open-ended entry that is still running.",
  }),
  description: z.string().optional(),
});

export const updateTimeEntryBody = z.object({
  startTime: timestamp,
  endTime: timestamp.optional(),
  description: z.string().optional(),
});
