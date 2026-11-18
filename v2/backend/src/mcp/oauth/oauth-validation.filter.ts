import { type ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { AllExceptionsFilter } from "../../common/errors/all-exceptions.filter";
import { ApiError } from "../../common/errors/api-error";

type OauthValidationError = "invalid_request" | "invalid_client_metadata";

/**
 * OAuth clients parse validation failures, so these routes answer with the
 * RFC 6749 / RFC 7591 JSON error shape instead of the API's. Every other
 * error keeps the API's handling.
 */
@Catch(ApiError)
export class OauthValidationFilter implements ExceptionFilter {
  private readonly fallback = new AllExceptionsFilter();

  constructor(private readonly error: OauthValidationError) {}

  catch(exception: ApiError, host: ArgumentsHost): void {
    if (exception.code !== "VALIDATION_ERROR") {
      this.fallback.catch(exception, host);
      return;
    }
    // The message is `<field>: <issue>`, as the previous API built it.
    const description = exception.message;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(400)
      .json({
        error: description.startsWith("redirect_uri")
          ? "invalid_redirect_uri"
          : this.error,
        error_description: description,
      });
  }
}
