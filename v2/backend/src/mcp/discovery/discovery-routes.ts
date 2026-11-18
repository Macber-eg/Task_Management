export const PROTECTED_RESOURCE_PATH =
  ".well-known/oauth-protected-resource/api/mcp";
export const AUTHORIZATION_SERVER_PATH =
  ".well-known/oauth-authorization-server/api";

/**
 * The discovery documents are served both under `/api` and at the root,
 * where MCP clients look first. Each copy is declared with its full path
 * and excluded from the global prefix.
 */
export const MCP_UNPREFIXED_ROUTES = [
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
  `api/${PROTECTED_RESOURCE_PATH}`,
  `api/${AUTHORIZATION_SERVER_PATH}`,
];
