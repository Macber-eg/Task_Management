import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { HTTPException } from "../common/errors/http-exception";
import { eventContext } from "../events/event-context";
import { Authenticator } from "./authenticator";
import type { ApiRequest } from "./principal";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Every route needs a caller unless it is marked `@Public()`. Hidden UI is
 * not an authorization check: this guard and the access rules are.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authenticator: Authenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ApiRequest>();

    let principal: Awaited<ReturnType<Authenticator["authenticate"]>>;
    try {
      principal = await this.authenticator.authenticate(request);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      this.logger.error("API authentication failed", error);
      throw new HTTPException(500, { message: "Internal Server Error" });
    }
    if (!principal) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    request.principal = principal;

    const windowId = request.get("X-Kaneo-Window-Id");
    const store = eventContext.getStore();
    if (store) {
      store.initiatorId = windowId
        ? `${principal.userId}:${windowId}`
        : principal.userId;
    }
    return true;
  }
}
