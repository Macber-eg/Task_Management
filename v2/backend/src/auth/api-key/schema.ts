import { z } from "../../common/openapi";

const permissions = z.record(z.string(), z.array(z.string()));

// Quota, rate limit, scope and owner are accepted so that a request setting
// one is told it may not (SERVER_ONLY_PROPERTY) instead of being ignored.
export const createApiKeyBody = z.object({
  configId: z.string().optional(),
  name: z.string().optional(),
  expiresIn: z.number().min(1).optional().nullable().default(null),
  prefix: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message:
        "Invalid prefix format, must be alphanumeric and contain only underscores and hyphens.",
    })
    .optional(),
  remaining: z.number().min(0).optional().nullable().default(null),
  metadata: z.any().optional(),
  refillAmount: z.number().min(1).optional(),
  refillInterval: z.number().optional(),
  rateLimitTimeWindow: z.number().optional(),
  rateLimitMax: z.number().optional(),
  rateLimitEnabled: z.boolean().optional(),
  permissions: permissions.optional(),
  userId: z.coerce.string().optional(),
  organizationId: z.coerce.string().optional(),
});

export type CreateApiKeyInput = z.output<typeof createApiKeyBody>;

export const updateApiKeyBody = z.object({
  configId: z.string().optional(),
  keyId: z.string(),
  userId: z.coerce.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  remaining: z.number().min(1).optional(),
  refillAmount: z.number().optional(),
  refillInterval: z.number().optional(),
  metadata: z.any().optional(),
  expiresIn: z.number().min(1).optional().nullable(),
  rateLimitEnabled: z.boolean().optional(),
  rateLimitTimeWindow: z.number().optional(),
  rateLimitMax: z.number().optional(),
  permissions: permissions.optional().nullable(),
});

export type UpdateApiKeyInput = z.output<typeof updateApiKeyBody>;

export const deleteApiKeyBody = z.object({
  configId: z.string().optional(),
  keyId: z.string(),
});

export const getApiKeyQuery = z.object({
  configId: z.string().optional(),
  id: z.string(),
});

export const listApiKeysQuery = z.object({
  configId: z.string().optional(),
  organizationId: z.string().optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  sortBy: z
    .enum([
      "id",
      "configId",
      "name",
      "start",
      "referenceId",
      "prefix",
      "key",
      "refillInterval",
      "refillAmount",
      "lastRefillAt",
      "enabled",
      "rateLimitEnabled",
      "rateLimitTimeWindow",
      "rateLimitMax",
      "requestCount",
      "remaining",
      "lastRequest",
      "expiresAt",
      "createdAt",
      "updatedAt",
      "permissions",
      "metadata",
    ])
    .optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
});

export type ListApiKeysQuery = z.output<typeof listApiKeysQuery>;
