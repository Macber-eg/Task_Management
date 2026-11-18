import { createRoute, jsonResponse, z } from "../../common/openapi";

export const deleteUserRoute = createRoute({
  method: "post",
  path: "/delete-user",
  hide: true,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            callbackURL: z.string().optional(),
            password: z.string().optional(),
            token: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: { 200: jsonResponse("Account deleted", z.unknown()) },
});
