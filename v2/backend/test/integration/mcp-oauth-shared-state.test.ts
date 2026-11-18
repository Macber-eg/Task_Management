import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { McpCodeExchange } from "../../src/mcp/oauth/code-exchange.service";
import { McpOauthFlowState } from "../../src/mcp/oauth/oauth-flow-state.service";
import { McpOauthStore } from "../../src/mcp/oauth/oauth-state.store";
import { createUser } from "../support/fixtures/create-user";
import { pkceChallenge } from "../support/fixtures/mcp-client";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: shared MCP OAuth state", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  /** A replica holds nothing in memory: only the database is shared. */
  function replica() {
    const flowState = new McpOauthFlowState(new McpOauthStore(app.dataSource));
    return { flowState, codes: new McpCodeExchange(app.dataSource, flowState) };
  }

  it("shares clients, authorization requests and codes across replicas", async () => {
    const first = replica();
    const redirectUri = "https://client.example/callback";
    const verifier = "shared-state-verifier";
    const codeChallenge = pkceChallenge(verifier);
    const client = await first.flowState.registerClient({
      redirectUris: [redirectUri],
      clientName: "Cross-replica test",
    });
    const requestId = await first.flowState.createAuthorizationRequest({
      clientId: client.clientId,
      redirectUri,
      codeChallenge,
    });

    const second = replica();
    await expect(second.flowState.getClient(client.clientId)).resolves.toMatchObject({
      clientId: client.clientId,
      redirectUris: [redirectUri],
    });
    await expect(
      second.flowState.getAuthorizationRequest(requestId),
    ).resolves.toMatchObject({ clientId: client.clientId, redirectUri });
    await expect(
      second.flowState.consumeAuthorizationRequest(requestId),
    ).resolves.toMatchObject({ clientId: client.clientId, redirectUri });
    await expect(
      first.flowState.getAuthorizationRequest(requestId),
    ).resolves.toBeNull();

    const user = await createUser(app.db, { name: "MCP OAuth test user" });
    const code = await second.flowState.createAuthCode({
      clientId: client.clientId,
      userId: user.id,
      redirectUri,
      codeChallenge,
    });

    const third = replica();
    await expect(
      third.codes.exchange(code, client.clientId, verifier, redirectUri),
    ).resolves.toMatchObject({ expiresIn: 30 * 24 * 60 * 60 });
    await expect(
      third.codes.exchange(code, client.clientId, verifier, redirectUri),
    ).resolves.toBeNull();
  });
});
