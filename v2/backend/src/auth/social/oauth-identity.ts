import type { AccountEntity } from "../../database/entities/account.entity";
import type { OAuthTokens, ProviderUser } from "./providers/oauth-provider";

/** A provider's user once the callback has checked it has an id and email. */
export type OAuthUserInfo = ProviderUser & {
  id: string;
  email: string;
  name: string;
};

/** Providers send `email_verified` as a boolean, some as a string. */
export function isVerified(value: unknown): boolean {
  return value === true || value === "true";
}

/** The `account` columns an OAuth sign-in writes. */
export type OAuthAccountData = {
  providerId: string;
  accountId: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
};

export function accountData(
  providerId: string,
  accountId: string,
  tokens: OAuthTokens,
): OAuthAccountData {
  return {
    providerId,
    accountId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    scope: tokens.scopes.join(","),
  };
}

type TokenColumns = Partial<
  Pick<
    AccountEntity,
    | "idToken"
    | "accessToken"
    | "refreshToken"
    | "accessTokenExpiresAt"
    | "refreshTokenExpiresAt"
    | "scope"
  >
>;

/** The token columns to refresh on an existing account; absent ones are kept. */
export function freshTokenColumns(
  account: OAuthAccountData,
): TokenColumns {
  const columns: TokenColumns = {};
  if (account.idToken !== undefined) columns.idToken = account.idToken;
  if (account.accessToken !== undefined) columns.accessToken = account.accessToken;
  if (account.refreshToken !== undefined)
    columns.refreshToken = account.refreshToken;
  if (account.accessTokenExpiresAt !== undefined)
    columns.accessTokenExpiresAt = account.accessTokenExpiresAt;
  if (account.refreshTokenExpiresAt !== undefined)
    columns.refreshTokenExpiresAt = account.refreshTokenExpiresAt;
  if (account.scope !== undefined) columns.scope = account.scope;
  return columns;
}
