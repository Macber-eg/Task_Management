import { readLastLoginMethod } from "./auth/last-login-method";
import { authRequest } from "./auth/request";
import {
  notifySignal,
  useActiveOrganizationQuery,
  useListOrganizationsQuery,
  useSessionQuery,
} from "./auth/store";
import type { AuthSignal } from "./auth/signals";
import type {
  ApiKey,
  AuthFetchOptions,
  AuthResult,
  CreatedApiKey,
  FullOrganization,
  Invitation,
  InvitationDetails,
  LinkedAccount,
  Member,
  MemberWithUser,
  Organization,
  OrgRole,
  SessionData,
  User,
  UserInvitation,
  WithFetchOptions,
} from "./auth/types";

type Body = Record<string, unknown>;

function mergeOptions(
  args: WithFetchOptions | undefined,
  options: AuthFetchOptions | undefined,
): AuthFetchOptions | undefined {
  if (!args?.fetchOptions) return options;
  return { ...args.fetchOptions, ...options };
}

type Args<Input> = [Input] extends [void]
  ? WithFetchOptions
  : Input & WithFetchOptions;

function post<Input extends Body | void, Output>(path: string) {
  return (
    args?: Args<Input>,
    options?: AuthFetchOptions,
  ): Promise<AuthResult<Output>> => {
    const { fetchOptions: _ignored, ...body } = (args ?? {}) as Body &
      WithFetchOptions;
    return authRequest<Output>(path, {
      method: "POST",
      body,
      fetchOptions: mergeOptions(args ?? undefined, options),
    });
  };
}

function get<Query extends Body | void, Output>(path: string) {
  return (
    args?: { query?: Query } & WithFetchOptions,
    options?: AuthFetchOptions,
  ): Promise<AuthResult<Output>> =>
    authRequest<Output>(path, {
      method: "GET",
      query: (args?.query ?? undefined) as Body | undefined,
      fetchOptions: mergeOptions(args, options),
    });
}

type CallbackUrls = {
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
  disableRedirect?: boolean;
};

type SignInResult = {
  redirect: boolean;
  token: string | null;
  url?: string;
  user: User;
};

type RedirectResult = { url: string; redirect: boolean };

type PermissionCheck = {
  permissions?: Record<string, string[]>;
  permission?: Record<string, string[]>;
};

type PermissionResult = { error: null; success: boolean };

type OrganizationInput = {
  name?: string;
  slug?: string;
  logo?: string;
  metadata?: Record<string, unknown>;
  description?: string;
};

// `GET /device?user_code=` claims a code; the same name exposes approve/deny.
const device = Object.assign(
  get<{ user_code: string }, { user_code: string; status: string }>("/device"),
  {
    approve: post<{ userCode: string }, { success: boolean }>(
      "/device/approve",
    ),
    deny: post<{ userCode: string }, { success: boolean }>("/device/deny"),
  },
);

/**
 * Talks to the `/api/auth/*` endpoints with the better-auth client's method
 * names and `{ data, error }` results, so call sites did not change.
 */
export const authClient = {
  useSession: useSessionQuery,
  useActiveOrganization: useActiveOrganizationQuery,
  useListOrganizations: useListOrganizationsQuery,

  getSession: get<
    { disableCookieCache?: boolean; disableRefresh?: boolean },
    SessionData | null
  >("/get-session"),
  getLastUsedLoginMethod: readLastLoginMethod,

  signIn: {
    email: post<
      {
        email: string;
        password: string;
        rememberMe?: boolean;
        callbackURL?: string;
      },
      SignInResult
    >("/sign-in/email"),
    social: post<
      CallbackUrls & { provider: string; requestSignUp?: boolean },
      RedirectResult | SignInResult
    >("/sign-in/social"),
    oauth2: post<
      CallbackUrls & { providerId: string; requestSignUp?: boolean },
      RedirectResult
    >("/sign-in/oauth2"),
    anonymous: post<void, { token: string; user: User }>("/sign-in/anonymous"),
    emailOtp: post<
      { email: string; otp: string; name?: string },
      { token: string; user: User }
    >("/sign-in/email-otp"),
  },
  signUp: {
    email: post<
      {
        email: string;
        password: string;
        name: string;
        image?: string;
        callbackURL?: string;
        locale?: string;
      },
      { token: string | null; user: User }
    >("/sign-up/email"),
  },
  signOut: post<void, { success: boolean }>("/sign-out"),

  emailOtp: {
    sendVerificationOtp: post<
      {
        email: string;
        type: "sign-in" | "email-verification" | "forget-password";
      },
      { success: boolean }
    >("/email-otp/send-verification-otp"),
  },
  requestPasswordReset: post<
    { email: string; redirectTo?: string },
    { status: boolean; message?: string }
  >("/request-password-reset"),
  resetPassword: post<
    { newPassword: string; token?: string },
    { status: boolean }
  >("/reset-password"),
  changePassword: post<
    {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    },
    { token: string | null; user: User }
  >("/change-password"),
  updateUser: post<
    { name?: string; image?: string | null; locale?: string },
    { status: boolean }
  >("/update-user"),
  deleteUser: post<
    { password?: string; token?: string; callbackURL?: string },
    { success: boolean; message: string }
  >("/delete-user"),
  listAccounts: get<void, LinkedAccount[]>("/list-accounts"),
  linkSocial: post<
    CallbackUrls & { provider: string; scopes?: string[] },
    RedirectResult
  >("/link-social"),

  organization: {
    create: post<
      OrganizationInput & {
        name: string;
        slug: string;
        userId?: string;
        keepCurrentActiveOrganization?: boolean;
      },
      Organization & { members?: Member[] }
    >("/organization/create"),
    update: post<
      { organizationId?: string; data: OrganizationInput },
      Organization
    >("/organization/update"),
    delete: post<{ organizationId: string }, Organization>(
      "/organization/delete",
    ),
    list: get<void, Organization[]>("/organization/list"),
    setActive: post<
      { organizationId?: string | null; organizationSlug?: string },
      FullOrganization | null
    >("/organization/set-active"),
    getFullOrganization: get<
      {
        organizationId?: string;
        organizationSlug?: string;
        membersLimit?: number;
      },
      FullOrganization | null
    >("/organization/get-full-organization"),
    listMembers: get<
      {
        organizationId?: string;
        organizationSlug?: string;
        limit?: number;
        offset?: number;
        sortBy?: string;
        sortDirection?: "asc" | "desc";
        filterField?: string;
        filterOperator?: string;
        filterValue?: string;
      },
      { members: MemberWithUser[]; total: number }
    >("/organization/list-members"),
    getActiveMember: get<void, MemberWithUser>(
      "/organization/get-active-member",
    ),
    updateMemberRole: post<
      { memberId: string; role: string | string[]; organizationId?: string },
      MemberWithUser
    >("/organization/update-member-role"),
    removeMember: post<
      { memberIdOrEmail: string; organizationId?: string },
      { member: Member }
    >("/organization/remove-member"),
    leave: post<{ organizationId: string }, Member>("/organization/leave"),
    inviteMember: post<
      {
        email: string;
        role: string | string[];
        organizationId?: string;
        resend?: boolean;
        projectAccess?: string;
        projectIds?: string[];
      },
      Invitation
    >("/organization/invite-member"),
    acceptInvitation: post<
      { invitationId: string },
      { invitation: Invitation; member: Member }
    >("/organization/accept-invitation"),
    rejectInvitation: post<
      { invitationId: string },
      { invitation: Invitation; member: null }
    >("/organization/reject-invitation"),
    cancelInvitation: post<{ invitationId: string }, Invitation>(
      "/organization/cancel-invitation",
    ),
    getInvitation: get<{ id: string }, InvitationDetails>(
      "/organization/get-invitation",
    ),
    listInvitations: get<{ organizationId?: string }, Invitation[]>(
      "/organization/list-invitations",
    ),
    listUserInvitations: get<{ email?: string }, UserInvitation[]>(
      "/organization/list-user-invitations",
    ),
    hasPermission: post<
      PermissionCheck & { organizationId?: string },
      PermissionResult
    >("/organization/has-permission"),
    listRoles: get<{ organizationId?: string }, OrgRole[]>(
      "/organization/list-roles",
    ),
    createRole: post<
      {
        role: string;
        permission: Record<string, string[]>;
        organizationId?: string;
      },
      { success: boolean; roleData: OrgRole }
    >("/organization/create-role"),
    updateRole: post<
      {
        roleName?: string;
        roleId?: string;
        organizationId?: string;
        data: { permission?: Record<string, string[]>; roleName?: string };
      },
      { success: boolean; roleData: OrgRole }
    >("/organization/update-role"),
    deleteRole: post<
      { roleName?: string; roleId?: string; organizationId?: string },
      { success: boolean }
    >("/organization/delete-role"),
  },

  apiKey: {
    create: post<
      {
        name?: string;
        expiresIn?: number | null;
        prefix?: string;
        metadata?: unknown;
        organizationId?: string;
        permissions?: Record<string, string[]>;
      },
      CreatedApiKey
    >("/api-key/create"),
    list: get<
      { organizationId?: string; limit?: number; offset?: number },
      { apiKeys: ApiKey[]; total: number; limit?: number; offset?: number }
    >("/api-key/list"),
    delete: post<{ keyId: string }, { success: boolean }>("/api-key/delete"),
  },

  admin: {
    hasPermission: post<
      PermissionCheck & { userId?: string },
      PermissionResult
    >("/admin/has-permission"),
    updateUser: post<{ userId: string; data: Body }, User>(
      "/admin/update-user",
    ),
    banUser: post<
      { userId: string; banReason?: string; banExpiresIn?: number },
      { user: User }
    >("/admin/ban-user"),
    unbanUser: post<{ userId: string }, { user: User }>("/admin/unban-user"),
    removeUser: post<{ userId: string }, { success: boolean }>(
      "/admin/remove-user",
    ),
  },

  device,

  $store: {
    notify: (signal: AuthSignal | (string & {})) =>
      notifySignal(signal as AuthSignal),
  },
};

export type AuthClient = typeof authClient;
