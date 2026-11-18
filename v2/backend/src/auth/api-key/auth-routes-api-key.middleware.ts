import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { HTTPException } from "../../common/errors/http-exception";
import { SessionService } from "../sessions/session.service";
import { ApiKeyAuthenticator } from "./api-key-authenticator";
import { apiKeyCredential } from "./api-key-credential";
import { apiKeyError } from "./api-key-error";
import { API_KEY_OPTIONS } from "./api-key-options";

/**
 * Every /auth route, public or not, answers a request carrying an API key
 * only if the key is usable, and charges the key once for it, as the
 * previous backend's auth library did. A Bearer token that is a session
 * token is left to the route.
 */
@Injectable()
export class AuthRoutesApiKeyMiddleware implements NestMiddleware {
  constructor(
    private readonly apiKeys: ApiKeyAuthenticator,
    private readonly sessions: SessionService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction) {
    const credential = apiKeyCredential(request);
    if (!credential) return next();

    // That library refused keys shorter than the ones it generates, after
    // checking them but before charging them.
    const fullLength = credential.key.length >= API_KEY_OPTIONS.keyLength;
    const principal = await this.apiKeys.authenticate(
      credential.key,
      { consume: fullLength },
      request,
    );

    if (!principal) {
      if (
        credential.fromBearer &&
        (await this.sessions.findByOpaqueToken(credential.key))
      ) {
        return next();
      }
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    if (!fullLength) throw apiKeyError("INVALID_API_KEY");
    next();
  }
}
