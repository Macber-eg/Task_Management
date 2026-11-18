import { Logger } from "@nestjs/common";
import { allowInsecureRequests, discovery } from "openid-client";

export type DiscoveredEndpoints = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
};

const logger = new Logger("OidcDiscovery");

function endpoints(metadata: Record<string, unknown>): DiscoveredEndpoints {
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  return {
    issuer: text(metadata.issuer),
    authorization_endpoint: text(metadata.authorization_endpoint),
    token_endpoint: text(metadata.token_endpoint),
    userinfo_endpoint: text(metadata.userinfo_endpoint),
  };
}

async function fetchDocument(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads the provider's metadata document from `CUSTOM_OAUTH_DISCOVERY_URL`.
 * The URL is used as given: a `.well-known` URL through openid-client
 * (plain HTTP allowed, as self-hosted identity providers often run on an
 * internal network), anything else fetched directly. Null when the document
 * cannot be read; callers then fall back to the manually configured URLs.
 */
export async function discoverEndpoints(
  discoveryUrl: string,
  clientId: string,
): Promise<DiscoveredEndpoints | null> {
  try {
    const url = new URL(discoveryUrl);
    if (!url.href.includes("/.well-known/")) {
      const document = await fetchDocument(url.href);
      return document ? endpoints(document) : null;
    }
    const configuration = await discovery(url, clientId, undefined, undefined, {
      execute: url.protocol === "http:" ? [allowInsecureRequests] : [],
    });
    return endpoints({ ...configuration.serverMetadata() });
  } catch (error) {
    logger.error(
      `OIDC discovery failed for ${discoveryUrl}`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
