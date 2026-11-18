import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const metadata = z.record(z.string(), z.any());

export const createOrganizationRoute = createRoute({
  method: "post",
  path: "/create",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        // Accepted for compatibility; only server-side callers could use it.
        userId: z.coerce.string().optional(),
        logo: z.string().nullish(),
        metadata: metadata.optional(),
        keepCurrentActiveOrganization: z.boolean().optional(),
        description: z.string().nullish(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The new workspace", anyJson) },
});

export const checkSlugRoute = createRoute({
  method: "post",
  path: "/check-slug",
  hide: true,
  request: { body: jsonBody(z.object({ slug: z.string() })) },
  responses: { 200: jsonResponse("The slug is free", anyJson) },
});

export const updateOrganizationRoute = createRoute({
  method: "post",
  path: "/update",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        data: z
          .object({
            description: z.string().nullish(),
            name: z.string().min(1).optional(),
            slug: z.string().min(1).optional(),
            logo: z.string().nullish(),
            metadata: metadata.optional(),
          })
          .partial(),
        organizationId: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The updated workspace", anyJson) },
});

export const deleteOrganizationRoute = createRoute({
  method: "post",
  path: "/delete",
  hide: true,
  request: { body: jsonBody(z.object({ organizationId: z.string() })) },
  responses: { 200: jsonResponse("The deleted workspace", anyJson) },
});

export const listOrganizationsRoute = createRoute({
  method: "get",
  path: "/list",
  hide: true,
  responses: { 200: jsonResponse("The caller's workspaces", anyJson) },
});

export const getFullOrganizationRoute = createRoute({
  method: "get",
  path: "/get-full-organization",
  hide: true,
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      organizationSlug: z.string().optional(),
      membersLimit: z
        .number()
        .or(z.string().transform((value) => Number.parseInt(value)))
        .optional(),
    }),
  },
  responses: {
    200: jsonResponse("The workspace with members and invitations", anyJson),
  },
});

export const setActiveOrganizationRoute = createRoute({
  method: "post",
  path: "/set-active",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        organizationId: z.string().nullable().optional(),
        organizationSlug: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The active workspace", anyJson) },
});
