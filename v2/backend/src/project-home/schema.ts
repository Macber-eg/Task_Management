import { z } from "../common/openapi";

export const projectIdParam = z.object({ projectId: z.string() });
export const bookmarkIdParam = z.object({ id: z.string() });

export const bookmarkBody = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
});

export const recentBody = z.object({
  itemType: z.enum(["phase", "sprint", "task", "document"]),
  itemId: z.string(),
  title: z.string().min(1),
  parentLabel: z.string().optional().nullable(),
});

export const looseRecord = z.record(z.string(), z.unknown());
