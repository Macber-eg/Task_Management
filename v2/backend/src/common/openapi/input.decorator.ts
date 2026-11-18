import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestWithRouteInput } from "./route-input.interceptor";

/**
 * Injects the request parts validated against the handler's `@ApiRoute`
 * schemas. Type the parameter as `RouteInput<typeof route>`.
 */
export const Input = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithRouteInput>().routeInput,
);
