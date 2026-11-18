import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { HTTPException } from "../../common/errors/http-exception";
import { ApiKeyAuthenticator } from "./api-key-authenticator";
import { apiKeyCredential } from "./api-key-credential";
import { ApiKeySessionService } from "./api-key-session.service";

/**
 * Answers get-session for an API key caller with the key's session before
 * the session route runs, as the previous backend's auth library did. Runs
 * after `AuthRoutesApiKeyMiddleware`, which has already checked and charged
 * the key; asking again returns that same result.
 */
@Injectable()
export class ApiKeyGetSessionMiddleware implements NestMiddleware {
  constructor(
    private readonly apiKeys: ApiKeyAuthenticator,
    private readonly sessions: ApiKeySessionService,
  ) {}

  async use(request: Request, response: Response, next: NextFunction) {
    const credential = apiKeyCredential(request);
    if (!credential) return next();

    const principal = await this.apiKeys.authenticate(
      credential.key,
      { consume: true },
      request,
    );
    if (!principal?.apiKey) return next();

    const session = await this.sessions.sessionFor(
      principal.apiKey,
      credential.key,
      request,
    );
    if (!session) throw new HTTPException(401, { message: "Unauthorized" });
    response.status(200).json(session);
  }
}
