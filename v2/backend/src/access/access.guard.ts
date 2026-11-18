import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import type { ApiRequest } from "../auth/principal";
import type { AccessRule, AccessRuleHandler } from "./access-rule";
import { ACCESS_RULES_KEY } from "./access-rules-key";

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules =
      this.reflector.get<AccessRule[] | undefined>(
        ACCESS_RULES_KEY,
        context.getHandler(),
      ) ?? [];
    const request = context.switchToHttp().getRequest<ApiRequest>();

    for (const rule of rules) {
      const handler = this.moduleRef.get<AccessRuleHandler>(rule.handler, {
        strict: false,
      });
      await handler.check(request, rule.options);
    }
    return true;
  }
}
