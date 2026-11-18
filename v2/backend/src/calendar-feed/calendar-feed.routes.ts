import { createRoute, errorResponse, jsonResponse, z } from "../common/openapi";
import { calendarFeedSchema } from "./response";
import {
  calendarFeedDeleteParam,
  calendarFeedProjectParam,
  calendarFeedTokenParam,
  createCalendarFeedBody,
} from "./schema";

const managementErrors = {
  400: errorResponse("Invalid request"),
  401: errorResponse("Authentication required"),
  403: errorResponse(
    "No access to the project, or missing project sharing permission",
  ),
  404: errorResponse("Project not found"),
};

export const getCalendarFeedRoute = createRoute({
  method: "get",
  path: "/{token}/calendar.ics",
  operationId: "getCalendarFeed",
  tags: ["Calendar feeds"],
  summary: "Subscribe to a calendar feed",
  description:
    "Read scheduled project tasks using a secret calendar feed link. Anyone with the link can read matching task titles, descriptions, and dates. Responses are streamed; descriptions longer than 4096 characters and titles or calendar names longer than 1024 characters are truncated with an ellipsis.",
  security: [],
  request: { params: calendarFeedTokenParam },
  responses: {
    200: {
      description: "iCalendar feed",
      content: { "text/calendar": { schema: z.string() } },
    },
    400: errorResponse("Invalid feed token"),
    404: errorResponse("Calendar feed not found or revoked"),
  },
});

export const listCalendarFeedsRoute = createRoute({
  method: "get",
  path: "/project/{projectId}",
  operationId: "listCalendarFeeds",
  tags: ["Calendar feeds"],
  summary: "List project calendar feeds",
  description:
    "List secret calendar subscription links. Requires project sharing permission.",
  request: { params: calendarFeedProjectParam },
  responses: {
    200: jsonResponse("Calendar feeds", z.array(calendarFeedSchema)),
    ...managementErrors,
  },
});

export const createCalendarFeedRoute = createRoute({
  method: "post",
  path: "/project/{projectId}",
  operationId: "createCalendarFeed",
  tags: ["Calendar feeds"],
  summary: "Create a calendar feed",
  description:
    "Create a calendar subscription matching any selected label, or all project tasks when no labels are selected. Tasks need a start or due date. All-day dates use the supplied time zone. Creating a missing workspace label definition also requires label:create permission.",
  request: {
    params: calendarFeedProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createCalendarFeedBody } },
    },
  },
  responses: {
    201: jsonResponse("Calendar feed created", calendarFeedSchema),
    ...managementErrors,
    403: errorResponse(
      "No access to the project, missing project:share permission, or missing label:create permission for a new workspace label definition",
    ),
  },
});

export const revokeCalendarFeedRoute = createRoute({
  method: "delete",
  path: "/project/{projectId}/{id}",
  operationId: "revokeCalendarFeed",
  tags: ["Calendar feeds"],
  summary: "Revoke a calendar feed",
  description:
    "Revoke a calendar subscription link, preventing further access through it.",
  request: { params: calendarFeedDeleteParam },
  responses: {
    200: jsonResponse(
      "Calendar feed revoked",
      z.object({ success: z.boolean() }),
    ),
    ...managementErrors,
    404: errorResponse("Project or calendar feed not found"),
  },
});
