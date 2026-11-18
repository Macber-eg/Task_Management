import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const sendVerificationOtpRoute = createRoute({
  method: "post",
  path: "/email-otp/send-verification-otp",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        email: z.string(),
        type: z.enum([
          "email-verification",
          "sign-in",
          "forget-password",
          "change-email",
        ]),
      }),
    ),
  },
  responses: { 200: jsonResponse("Code sent", anyJson) },
});

export const signInEmailOtpRoute = createRoute({
  method: "post",
  path: "/sign-in/email-otp",
  hide: true,
  request: {
    body: jsonBody(
      z.looseObject({
        email: z.string(),
        otp: z.string(),
        name: z.string().optional(),
        image: z.string().optional(),
        locale: z.string().nullish(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The user and access token", anyJson) },
});
