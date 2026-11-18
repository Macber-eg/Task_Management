import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";

/** The workspace the route's access rule resolved and verified. */
export const AuthorizedWorkspaceId = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const workspaceId = context
      .switchToHttp()
      .getRequest<ApiRequest>().workspaceId;
    if (!workspaceId) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }
    return workspaceId;
  },
);
