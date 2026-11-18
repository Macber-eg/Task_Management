import { Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { DataSource } from "typeorm";
import { deleteReturning, insertReturning } from "../../database/dml";
import { VerificationEntity } from "../../database/entities/verification.entity";
import { ALPHANUMERIC, randomString } from "../api-key/random-string";
import { apiOrigin, defaultOAuthErrorURL } from "../social/auth-urls";
import { redirectOnError } from "../social/oauth-redirect";
import {
  type OAuthStateData,
  type OAuthStateRequest,
  oauthStateDataSchema,
} from "./oauth-state-data";
import {
  clearStateCookie,
  readStateCookie,
  setStateCookie,
} from "./state-cookie";

const STATE_ALPHABET = `${ALPHANUMERIC}-_`;
const FLOW_TTL_MS = 10 * 60 * 1000;

export type GeneratedState = { state: string; codeVerifier: string };

/**
 * The OAuth `state` round trip: what a flow needs at the callback is kept
 * in a `verification` row keyed by the state value, and the state is bound
 * to the starting browser by a signed cookie.
 */
@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);

  constructor(private readonly dataSource: DataSource) {}

  async generate(
    request: OAuthStateRequest,
    response: Response,
    link?: { userId: string; email: string },
  ): Promise<GeneratedState> {
    const state = randomString(32, STATE_ALPHABET);
    const codeVerifier = randomString(128, STATE_ALPHABET);
    const data = {
      ...(request.additionalData ?? {}),
      callbackURL: request.callbackURL || apiOrigin(),
      codeVerifier,
      errorURL: request.errorCallbackURL,
      newUserURL: request.newUserCallbackURL,
      link,
      expiresAt: Date.now() + FLOW_TTL_MS,
      requestSignUp: request.requestSignUp,
      oauthState: state,
    };

    setStateCookie(response, state);
    await insertReturning(this.dataSource.manager, VerificationEntity, {
      identifier: state,
      value: JSON.stringify(data),
      expiresAt: new Date(Date.now() + FLOW_TTL_MS),
    });
    return { state, codeVerifier };
  }

  /**
   * Reads and spends the state a callback carries. Every failure redirects
   * to the flow's error page, or the default one when the state is unusable.
   */
  async consume(
    request: Request,
    response: Response,
    state: string | undefined,
  ): Promise<OAuthStateData & { errorURL: string }> {
    const defaultErrorURL = defaultOAuthErrorURL();
    if (!state) return redirectOnError(defaultErrorURL, "state_not_found");

    const manager = this.dataSource.manager;
    const row = await manager.findOne(VerificationEntity, {
      where: { identifier: state },
      order: { createdAt: "DESC" },
    });
    if (!row) return redirectOnError(defaultErrorURL, "state_mismatch");

    let data: OAuthStateData;
    try {
      data = oauthStateDataSchema.parse(JSON.parse(row.value));
    } catch (error) {
      this.logger.error("Failed to parse OAuth state", error);
      return redirectOnError(defaultErrorURL, "internal_server_error");
    }
    const errorURL = data.errorURL ?? defaultErrorURL;

    if (data.oauthState !== undefined && data.oauthState !== state) {
      return redirectOnError(errorURL, "state_mismatch");
    }
    // A state replayed from another browser is refused here.
    if (readStateCookie(request) !== state) {
      return redirectOnError(errorURL, "state_mismatch");
    }
    clearStateCookie(response);

    // Deleting is what spends the state: of two concurrent callbacks with
    // the same state, only one gets the row back.
    const spent = await deleteReturning(manager, VerificationEntity, {
      identifier: state,
    });
    if (spent.length === 0) return redirectOnError(errorURL, "state_mismatch");

    if (data.expiresAt < Date.now()) {
      return redirectOnError(errorURL, "state_mismatch");
    }
    return { ...data, errorURL };
  }
}
