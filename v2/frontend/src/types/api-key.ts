import type { authClient } from "@/lib/auth-client";
import type { ApiKey, CreatedApiKey } from "@/lib/auth/types";

export type { ApiKey };

export type CreateApiKeyRequest = NonNullable<
  Parameters<typeof authClient.apiKey.create>[0]
>;

export type CreateApiKeyClientRequest = Omit<CreateApiKeyRequest, "userId">;

export type CreateApiKeyResponse = CreatedApiKey;
