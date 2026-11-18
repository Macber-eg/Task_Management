import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { ApiClient } from "./api-client";
import { registerTools, type ToolRegistrar } from "./register";

export type McpToolRegistrar = ToolRegistrar;

/** What both MCP server generations accept: tools described by a raw Zod shape. */
type ShapeToolServer = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodRawShape },
    callback: (args: unknown) => Promise<CallToolResult>,
  ): unknown;
};

export function toMcpToolRegistrar(server: ShapeToolServer): McpToolRegistrar {
  return {
    registerTool: (name, config, callback) =>
      server.registerTool(
        name,
        {
          description: config.description,
          inputSchema: config.inputSchema.shape,
        },
        (args) => callback(args),
      ),
  };
}

export function registerMcpTools(
  server: McpToolRegistrar,
  baseUrl: string,
  token: string,
): void {
  registerTools(server, { client: new ApiClient(baseUrl, token) });
}
