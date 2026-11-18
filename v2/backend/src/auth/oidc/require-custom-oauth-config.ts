import { HTTPException } from "../../common/errors/http-exception";
import { type CustomOAuthConfig, customOAuthConfig } from "./custom-oauth-config";

/** The configured generic provider, or the 400 the previous API answered. */
export function requireCustomOAuthConfig(providerId: string): CustomOAuthConfig {
  const config = customOAuthConfig();
  if (providerId !== config.providerId) {
    throw new HTTPException(400, {
      message: `No config found for provider ${providerId}`,
    });
  }
  return config;
}
