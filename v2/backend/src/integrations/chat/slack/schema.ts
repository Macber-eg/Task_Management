import { z } from "../../../common/openapi";
import { integrationEventToggles } from "../../core/schema";

export const createSlackBody = z.object({
  webhookUrl: z.string().min(1),
  channelName: z.string().optional(),
  events: integrationEventToggles.optional(),
});

export const updateSlackBody = z.object({
  webhookUrl: z.string().optional(),
  channelName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  events: integrationEventToggles.optional(),
});
