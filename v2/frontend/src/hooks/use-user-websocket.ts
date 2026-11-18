import { windowId } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { wsUrl } from "@/lib/api/base-url";
import {
  evictInaccessibleWorkspaceCache,
  evictWorkspaceCache,
} from "@/lib/evict-workspace-cache";
import { authClient } from "@/lib/auth-client";
import { createSocketAuthRetry } from "@/lib/realtime/socket-auth-retry";
import { reconcileProjectAccess } from "@/lib/reconcile-project-access";

export function getUserWsUrl() {
  return `${wsUrl("ws/user")}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRY_DELAY = 30_000;
const BASE_DELAY = 1000;
const WS_PING_INTERVAL_MS = 30_000;

/**
 * Maintains a user-scoped WebSocket connection for receiving user-targeted
 * real-time events (e.g. NOTIFICATION_CREATED). Invalidates TanStack Query
 * caches as needed, so no polling is required.
 */
export function useUserWebSocket() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const { data: session } = authClient.useSession();
  const activeWorkspaceRef = useRef(session?.session?.activeOrganizationId);
  activeWorkspaceRef.current = session?.session?.activeOrganizationId;
  useEffect(() => {
    if (!session?.user?.id) return;

    // A previous session's delayed socket events must not control this session.
    let disposed = false;
    let userRevoked = false;
    let activeSocket: WebSocket | null = null;
    let retryDelay = BASE_DELAY;
    const authRetry = createSocketAuthRetry();
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    function clearPing() {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    function refreshOrganizationState() {
      for (const signal of [
        "$listOrg",
        "$activeOrgSignal",
        "$activeMemberRoleSignal",
        "$sessionSignal",
      ])
        authClient.$store.notify(signal);
    }

    function revokeUserAccess() {
      if (userRevoked) return;
      userRevoked = true;
      clearPing();
      queryClient.clear();
      refreshOrganizationState();
      void authClient
        .signOut()
        .finally(() => navigate({ to: "/auth/sign-in" }))
        .catch(() => {});
    }

    function connect() {
      if (disposed) return;
      retryTimeout = null;
      const url = getUserWsUrl();
      const ws = new WebSocket(url);
      activeSocket = ws;
      let opened = false;

      ws.onopen = () => {
        if (disposed || activeSocket !== ws) return;
        opened = true;
        authRetry.opened();
        retryDelay = BASE_DELAY;
        clearPing();
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed || activeSocket !== ws) return;
        try {
          const message = JSON.parse(event.data as string) as {
            type?: string;
            workspaceId?: string;
            workspaceIds?: string[] | null;
          };
          if (message.type === "USER_ACCESS_REVOKED") {
            revokeUserAccess();
            return;
          }
          if (
            message.type === "WORKSPACE_ACCESS_SYNC" &&
            Array.isArray(message.workspaceIds) &&
            message.workspaceIds.every((id) => typeof id === "string")
          ) {
            evictInaccessibleWorkspaceCache(queryClient, message.workspaceIds);
            for (const workspaceId of message.workspaceIds)
              reconcileProjectAccess(queryClient, workspaceId, () => !disposed);
            refreshOrganizationState();
            const path = pathnameRef.current;
            const current =
              /^\/dashboard\/settings\/(workspace|projects)(\/|$)/.test(path)
                ? activeWorkspaceRef.current
                : path.match(/^\/dashboard\/workspace\/([^/]+)/)?.[1];
            if (current && !message.workspaceIds.includes(current))
              void navigate({ to: "/dashboard" });
          }
          if (
            message.type === "WORKSPACE_ACCESS_REVOKED" &&
            message.workspaceId
          ) {
            evictWorkspaceCache(queryClient, message.workspaceId);
            refreshOrganizationState();
            const path = pathnameRef.current;
            const current =
              /^\/dashboard\/settings\/(workspace|projects)(\/|$)/.test(path)
                ? activeWorkspaceRef.current
                : path.match(/^\/dashboard\/workspace\/([^/]+)/)?.[1];
            if (current === message.workspaceId)
              void navigate({ to: "/dashboard" });
          }
          if (
            message.type === "PROJECT_ACCESS_CHANGED" &&
            message.workspaceId
          ) {
            const { workspaceId } = message;
            for (const queryKey of [
              ["projects", workspaceId],
              ["assigned-tasks", workspaceId],
              ["search", { workspaceId }],
              ["workspace-activity", workspaceId],
              ["labels", workspaceId],
              ["workspace-users", workspaceId, "project-access"],
              ["notifications"],
            ])
              void queryClient.invalidateQueries({ queryKey });
            reconcileProjectAccess(queryClient, workspaceId, () => !disposed);
          }
          if (message.type === "NOTIFICATION_CREATED") {
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (disposed || activeSocket !== ws) return;
        clearPing();
        activeSocket = null;
        if (event?.code === 1008) revokeUserAccess();
        if (userRevoked) return;

        // An expired access cookie fails the handshake (or closes with 4401):
        // renew the session once and reconnect straight away.
        const refreshing = authRetry.refreshFor(event?.code, opened);
        if (refreshing) {
          void refreshing.then((refreshed) => {
            if (disposed || userRevoked || activeSocket !== null) return;
            if (refreshed) connect();
            else scheduleReconnect();
          });
          return;
        }
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      retryTimeout = setTimeout(connect, delay);
    }

    connect();

    return () => {
      disposed = true;
      clearPing();
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
      activeSocket?.close();
    };
  }, [session?.user?.id, queryClient, navigate]);
}
