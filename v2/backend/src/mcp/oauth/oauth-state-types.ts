export type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  issuedAt: number;
};

export type AuthCode = {
  clientId: string;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
};

export type AuthorizationRequest = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state?: string;
};
