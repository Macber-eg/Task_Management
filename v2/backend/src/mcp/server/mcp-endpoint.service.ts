import { Injectable } from "@nestjs/common";
import { isJsonContentType, isLegacyRequest } from "@modelcontextprotocol/server";
import type { Request, Response } from "express";
import { protectedResourceMetadataUrl } from "../discovery/discovery-documents";
import { publicBaseUrl } from "../discovery/public-base-url";
import { internalApiUrl } from "./internal-api-url";
import { handleLegacyMcpRequest } from "./legacy-handler";
import { McpBearerAuthenticator } from "./mcp-bearer.service";
import { createModernMcpHandler } from "./modern-handler";
import { sendWebResponse, toWebRequest } from "./web-exchange";

/**
 * The stateless Streamable HTTP endpoint. Every POST is authenticated on
 * its own and served by a fresh server, so any replica can answer it.
 * 2026-era requests go to the modern handler, 2025-era ones to the legacy
 * SDK transport.
 */
@Injectable()
export class McpEndpoint {
  constructor(private readonly bearer: McpBearerAuthenticator) {}

  async handle(request: Request, response: Response): Promise<void> {
    const caller = await this.bearer.authenticate(request.get("authorization"));
    if (!caller) {
      const metadataUrl = protectedResourceMetadataUrl(publicBaseUrl());
      response
        .status(401)
        .set("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`)
        .json({
          error: "invalid_token",
          error_description: "Missing or invalid token",
        });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    if (!isJsonContentType(request.get("content-type"))) {
      response.status(415).json({ error: "Unsupported Media Type" });
      return;
    }

    const webRequest = toWebRequest(request);
    const apiUrl = internalApiUrl(request.socket.localPort);
    const webResponse = (await isLegacyRequest(webRequest.clone()))
      ? await handleLegacyMcpRequest(webRequest, caller.token, apiUrl)
      : await createModernMcpHandler(caller.token, apiUrl).fetch(webRequest);
    await sendWebResponse(webResponse, response);
  }
}
