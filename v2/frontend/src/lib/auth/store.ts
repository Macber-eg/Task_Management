import {
  QueryClient,
  type QueryKey,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { authRequest, onAuthCallSucceeded } from "./request";
import { type AuthSignal, broadcastTrigger, signalsForPath } from "./signals";
import type {
  AuthError,
  FullOrganization,
  MemberWithUser,
  Organization,
  SessionData,
} from "./types";

const CHANNEL_NAME = "kaneo.auth";

// Kept apart from the app's query client so clearing app caches (on sign-out
// or access loss) never drops the session state the guards read.
export const authQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: Number.POSITIVE_INFINITY,
      // better-auth skipped focus refetches within 5 s of the last request.
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

export const authKeys = {
  session: ["auth", "session"],
  listOrganizations: ["auth", "organizations"],
  activeOrganization: ["auth", "active-organization"],
  activeMember: ["auth", "active-member"],
  activeMemberRole: ["auth", "active-member-role"],
} as const satisfies Record<string, QueryKey>;

const SIGNAL_KEYS: Record<AuthSignal, QueryKey[]> = {
  $sessionSignal: [authKeys.session],
  $listOrg: [authKeys.listOrganizations],
  $activeOrgSignal: [
    authKeys.activeOrganization,
    authKeys.activeMember,
    authKeys.activeMemberRole,
  ],
  $activeMemberSignal: [authKeys.activeMember],
  $activeMemberRoleSignal: [authKeys.activeMemberRole],
};

/** Refetches the auth state a signal stands for (the better-auth `$store.notify`). */
export function notifySignal(signal: AuthSignal) {
  for (const queryKey of SIGNAL_KEYS[signal] ?? []) {
    void authQueryClient.invalidateQueries({ queryKey });
  }
}

let channel: BroadcastChannel | null = null;
let started = false;

function start() {
  if (started) return;
  started = true;
  authQueryClient.mount();
  if (typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  // Another tab signed in, out, or edited the user: reload everything.
  channel.onmessage = () => {
    void authQueryClient.invalidateQueries({ queryKey: ["auth"] });
  };
}

onAuthCallSucceeded((path) => {
  // Deferred like better-auth's signals, so a caller's own follow-up (such as
  // navigating away after sign-out) starts before the session refetches.
  setTimeout(() => {
    for (const signal of signalsForPath(path)) notifySignal(signal);
  }, 10);
  const trigger = broadcastTrigger(path);
  if (trigger) channel?.postMessage({ event: "session", trigger });
});

async function fetchOrThrow<T>(path: string): Promise<T | null> {
  // The store's own reads never raise signals; they would invalidate
  // themselves (`/organization/*` refreshes the active organization).
  const { data, error } = await authRequest<T | null>(path, {
    fetchOptions: { disableSignal: true },
  });
  if (!error) return data ?? null;
  // Like better-auth: unauthorised means "no data"; other failures keep the
  // last value and surface the error.
  if (error.status === 401) return null;
  throw error;
}

export type AuthQueryState<T> = {
  data: T | null;
  error: AuthError | null;
  isPending: boolean;
  isRefetching: boolean;
  // The argument (better-auth query overrides) is accepted and ignored: the
  // backend never serves sessions from a cookie cache.
  refetch: (options?: unknown) => Promise<void>;
};

function toState<T>(query: UseQueryResult<T | null, AuthError>) {
  const data = query.data ?? null;
  return {
    data,
    error: query.error ?? null,
    isPending: query.isPending || (query.isFetching && data === null),
    isRefetching: query.isFetching && !query.isPending,
    refetch: async (_options?: unknown) => {
      await query.refetch();
    },
  } satisfies AuthQueryState<T>;
}

function useAuthQuery<T>(queryKey: QueryKey, path: string) {
  start();
  const query = useQuery<T | null, AuthError>(
    { queryKey, queryFn: () => fetchOrThrow<T>(path) },
    authQueryClient,
  );
  return toState(query);
}

export function useSessionQuery() {
  return useAuthQuery<SessionData>(authKeys.session, "/get-session");
}

export function useActiveOrganizationQuery() {
  return useAuthQuery<FullOrganization>(
    authKeys.activeOrganization,
    "/organization/get-full-organization",
  );
}

export function useListOrganizationsQuery() {
  return useAuthQuery<Organization[]>(
    authKeys.listOrganizations,
    "/organization/list",
  );
}

export function useActiveMemberQuery() {
  return useAuthQuery<MemberWithUser>(
    authKeys.activeMember,
    "/organization/get-active-member",
  );
}
