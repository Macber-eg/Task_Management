import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { API_ROUTE_KEY, type ApiRouteConfig } from "./route";
import {
  validateRouteInput,
  type ValidatedInput,
} from "./validate-route-input";

export type RequestWithRouteInput = Request & { routeInput?: ValidatedInput };

/**
 * Runs after guards, so access and permission checks answer before a request
 * is told its body is invalid. That is the order the previous API used.
 */
@Injectable()
export class RouteInputInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const config = this.reflector.get<ApiRouteConfig | undefined>(
      API_ROUTE_KEY,
      context.getHandler(),
    );
    if (config) {
      const request = context
        .switchToHttp()
        .getRequest<RequestWithRouteInput>();
      request.routeInput = validateRouteInput(config, request);
    }
    return next.handle();
  }
}
