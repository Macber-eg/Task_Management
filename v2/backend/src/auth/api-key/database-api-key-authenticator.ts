import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "../principal";
import { ApiKeyAuthenticator } from "./api-key-authenticator";
import { recordApiKeyHeaders } from "./api-key-headers";
import { apiKeyRejection } from "./api-key-rejection";
import { ApiKeyVerifier } from "./api-key-verifier";
import { rateLimitHeaders } from "./rate-limit-headers";

@Injectable()
export class DatabaseApiKeyAuthenticator extends ApiKeyAuthenticator {
  // A request is charged once per key however many steps ask who it is
  // (the /auth routes' key check, the guard, get-session).
  private readonly charged = new WeakMap<
    Request,
    Map<string, Promise<Principal | null>>
  >();

  constructor(private readonly verifier: ApiKeyVerifier) {
    super();
  }

  authenticate(
    key: string,
    options: { consume: boolean },
    request: Request,
  ): Promise<Principal | null> {
    if (!options.consume) return this.verify(key, options, request);

    let byKey = this.charged.get(request);
    if (!byKey) {
      byKey = new Map();
      this.charged.set(request, byKey);
    }
    let result = byKey.get(key);
    if (!result) {
      result = this.verify(key, options, request);
      byKey.set(key, result);
    }
    return result;
  }

  private async verify(
    key: string,
    options: { consume: boolean },
    request: Request,
  ): Promise<Principal | null> {
    const result = await this.verifier.verify(key, options);
    if (!result) return null;
    if (result.status !== "valid") throw apiKeyRejection(result);

    if (result.rateLimit) {
      recordApiKeyHeaders(request, rateLimitHeaders(result.rateLimit));
    }

    return {
      userId: result.key.userId,
      userEmail: "",
      user: null,
      session: null,
      apiKey: result.key,
    };
  }
}
