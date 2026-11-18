import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { HTTPException } from "../common/errors/http-exception";
import type { ApiRequest, Principal } from "./principal";

function principalOf(context: ExecutionContext): Principal {
  const principal = context.switchToHttp().getRequest<ApiRequest>().principal;
  if (!principal) throw new HTTPException(401, { message: "Unauthorized" });
  return principal;
}

/** The authenticated caller. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => principalOf(context),
);

/** The authenticated caller's user id. */
export const UserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => principalOf(context).userId,
);
