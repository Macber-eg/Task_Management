/**
 * What the rest of the application asks of the WebSocket layer when access
 * changes. The realtime module provides the real implementation; until it is
 * registered, `NoopRealtimeConnections` stands in.
 */
export abstract class RealtimeConnections {
  /** Tells every socket of the user that their access was revoked. */
  abstract revokeUserConnections(userId: string): Promise<void>;

  /**
   * Drops the user's sockets for one workspace after they lose membership.
   * Instance admins keep access unless `force` is set; pass `role` when the
   * caller already knows the user's instance role.
   */
  abstract revokeWorkspaceConnections(
    userId: string,
    workspaceId: string,
    options?: { force?: boolean; role?: string | null },
  ): Promise<void>;

  /** Closes every socket subscribed to a project (it moved or was deleted). */
  abstract closeProjectConnections(projectId: string): Promise<void>;

  /** Closes the sockets opened by one login session (sign-out, revocation). */
  abstract revokeSessionConnections(sessionId: string): Promise<void>;
}
