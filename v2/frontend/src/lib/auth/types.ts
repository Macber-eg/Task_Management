// Shapes the `/api/auth/*` endpoints return, with ISO timestamps revived to
// `Date` the way the better-auth client did.

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  locale?: string | null;
  isAnonymous?: boolean | null;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
};

export type Session = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  activeOrganizationId?: string | null;
  activeTeamId?: string | null;
  impersonatedBy?: string | null;
};

export type SessionData = { session: Session; user: User };

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: Date;
  metadata?: unknown;
  description?: string | null;
};

export type Member = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

export type MemberUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export type MemberWithUser = Member & { user: MemberUser };

export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  teamId?: string | null;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
  projectAccess?: string | null;
  projectIds?: string[] | null;
};

export type UserInvitation = Invitation & {
  organizationName: string;
  organizationSlug?: string;
};

export type InvitationDetails = Invitation & {
  organizationName: string;
  organizationSlug: string;
  inviterEmail: string;
};

export type Team = {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt?: Date | null;
};

export type FullOrganization = Organization & {
  members: MemberWithUser[];
  invitations: Invitation[];
  teams?: Team[] | null;
};

export type OrgRole = {
  id: string;
  organizationId: string;
  role: string;
  permission: Record<string, string[]>;
  createdAt: Date;
  updatedAt?: Date | null;
};

export type ApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  referenceId: string;
  configId?: string;
  userId?: string;
  refillInterval: number | null;
  refillAmount: number | null;
  lastRefillAt: Date | null;
  enabled: boolean;
  rateLimitEnabled: boolean;
  rateLimitTimeWindow: number | null;
  rateLimitMax: number | null;
  requestCount: number;
  remaining: number | null;
  lastRequest: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
  permissions: Record<string, string[]> | null;
};

export type CreatedApiKey = ApiKey & { key: string };

export type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  userId: string;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
};

/** The error half of every auth call: the response body plus its status. */
export type AuthError = {
  message?: string;
  code?: string;
  status: number;
  statusText: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
};

export type AuthResult<T> =
  | { data: T; error: null }
  | { data: null; error: AuthError };

/** Per-call options, in the shape the better-auth client accepted. */
export type AuthFetchOptions = {
  headers?: HeadersInit;
  signal?: AbortSignal;
  onSuccess?: (context: { data: unknown; response: Response }) => unknown;
  onError?: (context: { error: AuthError; response: Response }) => unknown;
  /** Skip the session/organization refetches this call would trigger. */
  disableSignal?: boolean;
};

export type WithFetchOptions<T = object> = T & {
  fetchOptions?: AuthFetchOptions;
};
