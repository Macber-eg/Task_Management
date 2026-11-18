import { Injectable } from "@nestjs/common";
import type { ApiRequest } from "../auth/principal";
import { ApiError } from "../common/errors/api-error";
import type { AccessRuleHandler } from "./access-rule";

/** Sensitive account operations cannot inherit the owner's privileges from an API key. */
@Injectable()
export class UserSessionHandler implements AccessRuleHandler<void> {
  async check(request: ApiRequest): Promise<void> {
    // Set before the check so the refusal is not cached either.
    request.res?.setHeader("Cache-Control", "no-store");

    const principal = request.principal;
    if (principal?.apiKey || !principal?.session || !principal.user) {
      throw new ApiError(403, {
        message: "A user session is required",
        code: "SESSION_REQUIRED",
      });
    }
  }
}
