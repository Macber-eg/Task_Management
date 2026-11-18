import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { isSmtpConfigured } from "../../config/is-smtp-configured";
import { authError } from "../auth-error";
import { assertGuestRegistrationAllowed } from "../registration/registration-policy";
import { authCaptchaPaths } from "../turnstile/auth-captcha-paths";
import { verifyTurnstile } from "../turnstile/verify-turnstile";
import { authPath } from "./auth-path";
import { isLocalSignInPath } from "./is-local-sign-in-path";

/**
 * The checks the previous backend ran before any sign-in or sign-up route,
 * keyed on the route path and in the same order: local sign-in switched
 * off, password reset without email delivery, guest access, then CAPTCHA.
 * As a guard it answers before the body is validated, as they did.
 */
@Injectable()
export class AuthBeforeHooksGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = authPath(request);

    // The previous backend did not register the email-code routes at all.
    if (
      process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true" &&
      (path.startsWith("/email-otp/") || path === "/sign-in/email-otp")
    ) {
      throw new NotFoundException();
    }

    if (process.env.DISABLE_LOGIN_FORM === "true" && isLocalSignInPath(path)) {
      throw authError("LOCAL_SIGN_IN_DISABLED");
    }

    if (path === "/request-password-reset" && !isSmtpConfigured()) {
      throw authError("EMAIL_DELIVERY_NOT_CONFIGURED");
    }

    if (path === "/sign-in/anonymous") {
      await assertGuestRegistrationAllowed(this.dataSource.manager);
    }

    if (authCaptchaPaths.has(path)) {
      const body = request.body as { turnstileToken?: unknown } | undefined;
      const verdict = await verifyTurnstile(
        request.get("x-turnstile-token") ?? body?.turnstileToken,
      );
      if (!verdict.ok) throw authError("CAPTCHA_FAILED", verdict.reason);
    }

    return true;
  }
}
