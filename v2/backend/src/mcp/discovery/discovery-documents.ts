/** RFC 9728 metadata for the MCP endpoint. */
export function protectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [`${baseUrl}/api`],
  };
}

/** RFC 8414 metadata for the authorization server behind the MCP endpoint. */
export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: `${baseUrl}/api`,
    authorization_endpoint: `${baseUrl}/api/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/mcp/token`,
    registration_endpoint: `${baseUrl}/api/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function protectedResourceMetadataUrl(baseUrl: string): string {
  return `${baseUrl}/api/.well-known/oauth-protected-resource/api/mcp`;
}
