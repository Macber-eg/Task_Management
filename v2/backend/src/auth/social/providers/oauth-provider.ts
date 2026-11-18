export type OAuthTokens = {
  tokenType?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scopes: string[];
  idToken?: string;
};

/** The person a provider vouches for, in the shape account linking reads. */
export type ProviderUser = {
  id: string | number;
  name?: string;
  email?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  [claim: string]: unknown;
};

export type AuthorizationRequest = {
  state: string;
  codeVerifier: string;
  redirectURI: string;
  scopes?: string[];
  loginHint?: string;
};

export type CodeExchange = {
  code: string;
  codeVerifier: string;
  redirectURI: string;
  deviceId?: string;
};

/** A sign-in provider as the social sign-in routes drive it. */
export interface OAuthProvider {
  readonly id: string;
  createAuthorizationURL(request: AuthorizationRequest): Promise<URL>;
  /** Null, or a thrown error, when the code is refused. */
  validateAuthorizationCode(exchange: CodeExchange): Promise<OAuthTokens | null>;
  getUserInfo(
    tokens: OAuthTokens & { user?: unknown },
  ): Promise<{ user: ProviderUser } | null>;
}
