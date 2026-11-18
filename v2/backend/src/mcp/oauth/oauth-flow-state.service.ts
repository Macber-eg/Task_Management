import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { McpOauthStore } from "./oauth-state.store";
import type {
  AuthCode,
  AuthorizationRequest,
  RegisteredClient,
} from "./oauth-state-types";

// Clients re-register on invalid_client, so the TTL only bounds table growth.
const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;

/** Registered clients, pending consent requests and issued codes. */
@Injectable()
export class McpOauthFlowState {
  constructor(private readonly store: McpOauthStore) {}

  getClient(clientId: string): Promise<RegisteredClient | null> {
    return this.store.get<RegisteredClient>("client", clientId);
  }

  async registerClient(params: {
    redirectUris: string[];
    clientName?: string;
  }): Promise<RegisteredClient> {
    const clientId = randomUUID();
    const client: RegisteredClient = {
      clientId,
      redirectUris: [...params.redirectUris],
      clientName: params.clientName,
      issuedAt: Math.floor(Date.now() / 1000),
    };
    await this.store.put(
      "client",
      clientId,
      client,
      new Date(Date.now() + CLIENT_TTL_MS),
    );
    return client;
  }

  /** With `requestId`, the consent request is spent by issuing the code. */
  async createAuthCode(params: AuthCode, requestId?: string): Promise<string> {
    const code = randomUUID();
    await this.store.put(
      "code",
      code,
      params,
      new Date(Date.now() + CODE_TTL_MS),
      requestId,
    );
    return code;
  }

  consumeAuthCode(code: string): Promise<AuthCode | null> {
    return this.store.consume<AuthCode>("code", code);
  }

  async createAuthorizationRequest(
    params: AuthorizationRequest,
  ): Promise<string> {
    const requestId = randomUUID();
    await this.store.put(
      "request",
      requestId,
      params,
      new Date(Date.now() + REQUEST_TTL_MS),
    );
    return requestId;
  }

  getAuthorizationRequest(
    requestId: string,
  ): Promise<AuthorizationRequest | null> {
    return this.store.get<AuthorizationRequest>("request", requestId);
  }

  consumeAuthorizationRequest(
    requestId: string,
  ): Promise<AuthorizationRequest | null> {
    return this.store.consume<AuthorizationRequest>("request", requestId);
  }
}
