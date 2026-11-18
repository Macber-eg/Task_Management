import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerMcpTools, toMcpToolRegistrar } from "../tools/mcp-tool-registrar";

/**
 * Serves one 2025-era request. A fresh stateless transport lets legacy POSTs
 * reach any replica; it also accepts session IDs issued before the endpoint
 * became stateless, after their owner is gone.
 */
export async function handleLegacyMcpRequest(
  request: Request,
  token: string,
  apiUrl: string,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = new McpServer({ name: "kaneo-mcp", version: "1.0.0" });
  registerMcpTools(toMcpToolRegistrar(server), apiUrl, token);
  await server.connect(transport);
  return transport.handleRequest(request);
}
