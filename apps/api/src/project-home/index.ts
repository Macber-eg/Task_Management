import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createProjectBookmark,
  deleteProjectBookmark,
  listProjectBookmarks,
  updateProjectBookmark,
} from "./controllers/bookmarks";
import { listProjectAssets } from "./controllers/list-assets";
import { listProjectRecent, recordProjectRecent } from "./controllers/recent";

const projectIdParam = z.object({ projectId: z.string() });
const bookmarkIdParam = z.object({ id: z.string() });

const bookmarkBody = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
});

const recentBody = z.object({
  itemType: z.enum(["phase", "sprint", "task", "document"]),
  itemId: z.string(),
  title: z.string().min(1),
  parentLabel: z.string().optional().nullable(),
});

const projectHome = apiRouter()
  .openapi(
    createRoute({
      method: "get",
      operationId: "listProjectBookmarks",
      path: "/bookmarks/{projectId}",
      tags: ["Project Home"],
      middleware: [workspaceAccess.fromProjectId()] as const,
      request: { params: projectIdParam },
      responses: {
        200: jsonResponse(
          "Bookmarks",
          z.array(z.record(z.string(), z.unknown())),
        ),
      },
    }),
    async (c) =>
      c.json(
        await listProjectBookmarks(
          c.req.valid("param").projectId,
          c.get("userId"),
        ),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      operationId: "createProjectBookmark",
      path: "/bookmarks/{projectId}",
      tags: ["Project Home"],
      middleware: [workspaceAccess.fromProjectId()] as const,
      request: {
        params: projectIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: bookmarkBody } },
        },
      },
      responses: {
        200: jsonResponse("Bookmark", z.record(z.string(), z.unknown())),
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const body = c.req.valid("json");
      return c.json(
        await createProjectBookmark(
          projectId,
          c.get("userId"),
          body.title,
          body.url,
        ),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "put",
      operationId: "updateProjectBookmark",
      path: "/bookmark/{id}",
      tags: ["Project Home"],
      request: {
        params: bookmarkIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: bookmarkBody } },
        },
      },
      responses: {
        200: jsonResponse("Bookmark", z.record(z.string(), z.unknown())),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(
        await updateProjectBookmark(
          c.req.valid("param").id,
          c.get("userId"),
          body.title,
          body.url,
        ),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      operationId: "deleteProjectBookmark",
      path: "/bookmark/{id}",
      tags: ["Project Home"],
      request: { params: bookmarkIdParam },
      responses: {
        200: jsonResponse("Bookmark", z.record(z.string(), z.unknown())),
      },
    }),
    async (c) =>
      c.json(
        await deleteProjectBookmark(c.req.valid("param").id, c.get("userId")),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      operationId: "listProjectRecent",
      path: "/recent/{projectId}",
      tags: ["Project Home"],
      middleware: [workspaceAccess.fromProjectId()] as const,
      request: { params: projectIdParam },
      responses: {
        200: jsonResponse("Recent", z.array(z.record(z.string(), z.unknown()))),
      },
    }),
    async (c) =>
      c.json(
        await listProjectRecent(
          c.req.valid("param").projectId,
          c.get("userId"),
        ),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      operationId: "recordProjectRecent",
      path: "/recent/{projectId}",
      tags: ["Project Home"],
      middleware: [workspaceAccess.fromProjectId()] as const,
      request: {
        params: projectIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: recentBody } },
        },
      },
      responses: {
        200: jsonResponse("Recent", z.array(z.record(z.string(), z.unknown()))),
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      return c.json(
        await recordProjectRecent(
          projectId,
          c.get("userId"),
          c.req.valid("json"),
        ),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      operationId: "listProjectHomeAssets",
      path: "/assets/{projectId}",
      tags: ["Project Home"],
      middleware: [workspaceAccess.fromProjectId()] as const,
      request: { params: projectIdParam },
      responses: {
        200: jsonResponse("Assets", z.array(z.record(z.string(), z.unknown()))),
      },
    }),
    async (c) =>
      c.json(await listProjectAssets(c.req.valid("param").projectId), 200),
  );

export default projectHome;
