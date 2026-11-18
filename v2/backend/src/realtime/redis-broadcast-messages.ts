import { z } from "zod";

export const broadcastMessageSchema = z.object({
  projectId: z.string(),
  message: z.object({
    type: z.string(),
    projectId: z.string(),
    taskId: z.string().optional(),
    tasks: z
      .array(
        z.object({
          id: z.string(),
          position: z.number(),
          status: z.string().optional(),
        }),
      )
      .optional(),
    sourceTaskId: z.string().optional(),
    targetTaskId: z.string().optional(),
    linksChanged: z.boolean().optional(),
    taskTitleChanged: z.boolean().optional(),
  }),
  excludeInitiatorId: z.string().optional(),
  authorizationBatch: z.string().optional(),
});

export const userBroadcastSchema = z.object({
  userId: z.string(),
  message: z.looseObject({ type: z.string() }),
  origin: z.string().optional(),
});

export const sessionRevocationSchema = z.object({
  sessionId: z.string(),
  origin: z.string(),
});
