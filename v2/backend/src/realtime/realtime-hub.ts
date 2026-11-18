import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { hasInstanceAdminRole } from "../access/instance-admin-role";
import type {
  BroadcastAdapter,
  BroadcastMessage,
  ProjectBroadcastMessage,
  UserBroadcast,
  UserBroadcastMessage,
} from "./broadcast-adapter";
import { BroadcastAdapterFactory } from "./broadcast-adapter-factory";
import { BroadcastAuthorization } from "./broadcast-authorization";
import { ConnectionRegistry } from "./connection-registry";
import {
  ProjectBroadcastQueue,
  type QueuedBroadcast,
} from "./project-broadcast-queue";
import { RealtimeAccessReader } from "./realtime-access-reader";
import { RealtimeConnections } from "./realtime-connections";
import type {
  ProjectConnection,
  RealtimeSocket,
  UserConnection,
} from "./realtime-socket";
import {
  createRevocationDelivery,
  type RevocationDelivery,
} from "./revocation-delivery";
import { syncWorkspaceAccess } from "./workspace-access-sync";

function close(socket: RealtimeSocket, code: number, reason: string) {
  try {
    socket.close(code, reason);
  } catch {
    /* Already closed. */
  }
}

/**
 * The sockets open on this instance and everything delivered to them:
 * batched project broadcasts, user messages, and access revocations, fanned
 * out to other instances through the broadcast adapter.
 */
@Injectable()
export class RealtimeHub extends RealtimeConnections implements OnModuleInit {
  private readonly logger = new Logger(RealtimeHub.name);
  private readonly instanceId = randomUUID();
  private readonly connections = new ConnectionRegistry();
  private readonly queue = new ProjectBroadcastQueue((projectId, queued) =>
    this.flush(projectId, queued),
  );
  private readonly authorization: BroadcastAuthorization;
  private adapter: BroadcastAdapter | null = null;
  private revocationDelivery: RevocationDelivery | undefined;
  private receivedRevocations: RevocationDelivery | undefined;

  constructor(
    private readonly reader: RealtimeAccessReader,
    private readonly adapters: BroadcastAdapterFactory,
  ) {
    super();
    this.authorization = new BroadcastAuthorization(reader);
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.adapter) return;
    const next = await this.adapters.create();

    const retryReceived = createRevocationDelivery({
      publishToUser: async (msg) => {
        if (
          await this.reader.hasWorkspaceAccess(
            msg.userId,
            msg.message.workspaceId as string,
          )
        )
          return;
        if (this.receivedRevocations !== retryReceived) return;
        this.deliverToUser(msg.userId, msg.message);
      },
    });
    this.receivedRevocations = retryReceived;
    try {
      await next.subscribe((msg: BroadcastMessage) =>
        this.deliverToProject(
          msg.projectId,
          msg.message,
          msg.excludeInitiatorId,
          msg.authorizationBatch,
        ),
      );
      await next.subscribeToUser(
        (msg) => this.receiveUserBroadcast(msg, retryReceived),
        () => this.recover(),
      );
      await next.subscribeToSessionRevocations((msg) => {
        if (msg.origin !== this.instanceId)
          this.closeLocalSessionConnections(msg.sessionId);
      });
    } catch (error) {
      retryReceived.stop();
      this.receivedRevocations = undefined;
      await next.shutdown().catch(() => {});
      throw error;
    }

    this.adapter = next;
    this.revocationDelivery = createRevocationDelivery(next);
    this.logger.log(`WebSockets initialized using ${next.constructor.name}`);
  }

  /** Publishes what is still queued, then disconnects the adapter. */
  async stop(): Promise<void> {
    this.revocationDelivery?.stop();
    this.revocationDelivery = undefined;
    this.receivedRevocations?.stop();
    this.receivedRevocations = undefined;
    const pending = this.queue.drain();

    const adapter = this.adapter;
    if (adapter) {
      await Promise.allSettled(
        pending.flatMap(([projectId, queued]) =>
          queued.map(({ message, excludeInitiatorId }) =>
            adapter.publish({ projectId, message, excludeInitiatorId }),
          ),
        ),
      );
    }
    await adapter?.shutdown();
    this.adapter = null;
  }

  addProjectConnection(
    projectId: string,
    socket: RealtimeSocket,
    fields: Omit<ProjectConnection, "socket">,
  ): ProjectConnection {
    const connection: ProjectConnection = { socket, ...fields };
    this.connections.addProject(projectId, connection);
    return connection;
  }

  removeProjectConnection(projectId: string, connection: ProjectConnection) {
    this.connections.removeProject(projectId, connection);
  }

  addUserConnection(
    userId: string,
    socket: RealtimeSocket,
    sessionId: string | null = null,
  ): UserConnection {
    const connection: UserConnection = { socket, sessionId };
    this.connections.addUser(userId, connection);
    return connection;
  }

  removeUserConnection(userId: string, connection: UserConnection) {
    this.connections.removeUser(userId, connection);
  }

  syncWorkspaceAccess(userId: string, socket: RealtimeSocket): Promise<void> {
    return syncWorkspaceAccess(this.reader, userId, socket);
  }

  broadcastToUser(userId: string, message: UserBroadcastMessage): void {
    this.deliverToUser(userId, message);
    if (!this.adapter) return;
    void this.adapter
      .publishToUser({ userId, message, origin: this.instanceId })
      .catch((error: unknown) => {
        this.logger.error("Failed to publish a user broadcast:", error);
      });
  }

  /** Queues a project update; listeners get it within 100ms. */
  broadcastToProject(
    projectId: string,
    message: ProjectBroadcastMessage,
    excludeInitiatorId?: string,
  ): void {
    if (!this.adapter) {
      this.logger.warn("broadcastToProject called before adapter initialization");
      return;
    }
    this.queue.enqueue(projectId, message, excludeInitiatorId);
  }

  /** Publishes at once and waits for the adapter, bypassing the batch. */
  async publishToProject(
    projectId: string,
    message: ProjectBroadcastMessage,
    excludeInitiatorId?: string,
  ): Promise<void> {
    await this.adapter?.publish({ projectId, message, excludeInitiatorId });
  }

  /** The user's project access changed: re-check their open boards everywhere. */
  async projectAccessChanged(userId: string, workspaceId: string) {
    const message = { type: "PROJECT_ACCESS_CHANGED", workspaceId };
    this.deliverToUser(userId, message);
    await this.revocationDelivery?.send({
      userId,
      message,
      origin: this.instanceId,
    });
  }

  async revokeUserConnections(userId: string): Promise<void> {
    const message = { type: "USER_ACCESS_REVOKED" };
    this.deliverToUser(userId, message);
    await this.revocationDelivery?.send({
      userId,
      message,
      origin: this.instanceId,
    });
  }

  async revokeWorkspaceConnections(
    userId: string,
    workspaceId: string,
    options: { force?: boolean; role?: string | null } = {},
  ): Promise<void> {
    if (!options.force) {
      try {
        const user =
          "role" in options
            ? { role: options.role ?? null }
            : await this.reader.userRole(userId);
        if (hasInstanceAdminRole(user?.role)) return;
      } catch (error) {
        this.logger.error(
          "Failed to read role after membership removal:",
          error,
        );
      }
    }
    this.deliverToUser(userId, {
      type: "WORKSPACE_ACCESS_REVOKED",
      workspaceId,
    });
    await this.revocationDelivery?.send(
      {
        userId,
        message: {
          type: "WORKSPACE_ACCESS_REVOKED",
          workspaceId,
          ...(options.force ? { force: true } : {}),
        },
        origin: this.instanceId,
      },
      options.force
        ? undefined
        : async () => !(await this.reader.hasWorkspaceAccess(userId, workspaceId)),
    );
  }

  async closeProjectConnections(projectId: string): Promise<void> {
    this.closeLocalProjectConnections(projectId);
    try {
      await this.adapter?.publish({
        projectId,
        message: { type: "PROJECT_MOVED", projectId },
      });
    } catch (error) {
      // Delivery also checks the workspace, so missed Redis notifications cannot
      // leave old connections receiving future project updates.
      this.logger.error("Failed to publish project move:", error);
    }
  }

  async revokeSessionConnections(sessionId: string): Promise<void> {
    this.closeLocalSessionConnections(sessionId);
    // Not awaited: signing out must not wait for a Redis outage to end.
    void this.adapter
      ?.publishSessionRevocation({ sessionId, origin: this.instanceId })
      .catch((error: unknown) => {
        this.logger.error("Failed to publish a session revocation:", error);
      });
  }

  private flush(projectId: string, queued: QueuedBroadcast[]) {
    const adapter = this.adapter;
    if (!adapter) return;
    // Only this captured flush may share its authorization snapshot.
    const authorizationBatch = randomUUID();
    for (const { message, excludeInitiatorId } of queued) {
      void adapter
        .publish({ projectId, message, excludeInitiatorId, authorizationBatch })
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to publish broadcast for project ${projectId}:`,
            error,
          );
        });
    }
  }

  private async receiveUserBroadcast(
    msg: UserBroadcast,
    retryReceived: RevocationDelivery,
  ) {
    if (msg.origin === this.instanceId) return;
    if (
      msg.message.type === "WORKSPACE_ACCESS_REVOKED" &&
      typeof msg.message.workspaceId === "string" &&
      !msg.message.force
    ) {
      try {
        // Redis can deliver an offline-queued initial publish after this
        // member has been re-added. Check the recipient's current access.
        if (
          await this.reader.hasWorkspaceAccess(
            msg.userId,
            msg.message.workspaceId,
          )
        )
          return;
      } catch (error) {
        this.logger.error(
          "Failed to verify received workspace revocation:",
          error,
        );
        await retryReceived.send(msg);
        return;
      }
    }
    this.deliverToUser(msg.userId, msg.message);
  }

  /** After the Redis subscriber reconnects: messages may have been missed. */
  private async recover() {
    await Promise.all([
      ...[...this.connections.users].flatMap(([userId, connections]) =>
        [...connections].map(({ socket }) =>
          this.syncWorkspaceAccess(userId, socket),
        ),
      ),
      this.recheckLocalProjectAccess(),
    ]);
  }

  private deliverToUser(userId: string, message: UserBroadcastMessage) {
    if (
      message.type === "WORKSPACE_ACCESS_REVOKED" &&
      typeof message.workspaceId === "string"
    ) {
      this.revokeLocalWorkspaceConnections(userId, message.workspaceId);
    }
    if (
      message.type === "PROJECT_ACCESS_CHANGED" &&
      typeof message.workspaceId === "string"
    ) {
      void this.revokeLocalProjectConnections(userId, message.workspaceId);
    }
    const allAccessRevoked = message.type === "USER_ACCESS_REVOKED";
    if (allAccessRevoked) {
      for (const { projectId, connection } of this.connections.projectConnections(
        (candidate) => candidate.userId === userId,
      )) {
        this.connections.removeProject(projectId, connection);
        close(connection.socket, 1008, "User access revoked");
      }
    }
    const connections = this.connections.users.get(userId);
    if (!connections) return;

    const payload = JSON.stringify(message);
    for (const connection of connections) {
      try {
        connection.socket.send(payload);
      } catch {
        connections.delete(connection);
      }
      if (allAccessRevoked) {
        connections.delete(connection);
        close(connection.socket, 1008, "User access revoked");
      }
    }
    if (connections.size === 0) this.connections.users.delete(userId);
  }

  private async deliverToProject(
    projectId: string,
    message: ProjectBroadcastMessage,
    excludeInitiatorId?: string,
    authorizationBatch: string = randomUUID(),
  ) {
    if (message.type === "PROJECT_MOVED") {
      this.closeLocalProjectConnections(projectId);
      return;
    }
    const connections = this.connections.projects.get(projectId);
    if (!connections) return;
    const recipients = [...connections];
    const access = await this.authorization.check(
      projectId,
      recipients.map((connection) => connection.userId),
      authorizationBatch,
    );
    if (!access) return;
    const { workspaceId, members, restricted } = access;
    const payload = JSON.stringify(message);
    for (const connection of recipients) {
      // A move may have closed these connections while the lookup was in flight.
      if (!this.connections.hasProject(projectId, connection)) continue;
      const revoked =
        connection.workspaceId !== workspaceId
          ? "Project workspace changed"
          : !members.has(connection.userId)
            ? "Workspace access revoked"
            : restricted.has(connection.userId)
              ? "Project access revoked"
              : null;
      if (revoked) {
        this.connections.removeProject(projectId, connection);
        close(connection.socket, 1008, revoked);
        continue;
      }
      if (excludeInitiatorId && connection.initiatorId === excludeInitiatorId)
        continue;
      try {
        connection.socket.send(payload);
      } catch {
        this.connections.removeProject(projectId, connection);
      }
    }
  }

  private closeLocalProjectConnections(projectId: string) {
    this.queue.discard(projectId);
    const connections = this.connections.projects.get(projectId);
    this.connections.projects.delete(projectId);
    for (const connection of connections ?? []) {
      try {
        connection.socket.send(
          JSON.stringify({ type: "PROJECT_MOVED", projectId }),
        );
      } catch {
        /* The socket may already be closed. */
      }
      close(connection.socket, 1008, "Project workspace changed");
    }
  }

  private closeLocalSessionConnections(sessionId: string) {
    for (const { projectId, connection } of this.connections.projectConnections(
      (candidate) => candidate.sessionId === sessionId,
    )) {
      this.connections.removeProject(projectId, connection);
      close(connection.socket, 1008, "Session revoked");
    }
    for (const [userId, connections] of [...this.connections.users]) {
      for (const connection of [...connections]) {
        if (connection.sessionId !== sessionId) continue;
        this.connections.removeUser(userId, connection);
        close(connection.socket, 1008, "Session revoked");
      }
    }
  }

  private revokeLocalWorkspaceConnections(userId: string, workspaceId: string) {
    for (const { projectId, connection } of this.connections.projectConnections(
      (candidate) =>
        candidate.userId === userId && candidate.workspaceId === workspaceId,
    )) {
      this.connections.removeProject(projectId, connection);
      close(connection.socket, 1008, "Workspace access revoked");
    }
  }

  private async revokeLocalProjectConnections(
    userId: string,
    workspaceId?: string,
  ): Promise<Set<string>> {
    const revokedWorkspaceIds = new Set<string>();
    const owned = this.connections.projectConnections(
      (candidate) =>
        candidate.userId === userId &&
        (workspaceId === undefined || candidate.workspaceId === workspaceId),
    );
    if (owned.length === 0) return revokedWorkspaceIds;
    let denied: Set<string>;
    try {
      denied = new Set(
        await this.reader.findInaccessibleProjectIds(
          userId,
          owned.map(({ projectId }) => projectId),
        ),
      );
    } catch (error) {
      this.logger.error("Failed to verify project access:", error);
      return revokedWorkspaceIds;
    }
    for (const { projectId, connection } of owned) {
      if (!denied.has(projectId)) continue;
      if (!this.connections.hasProject(projectId, connection)) continue;
      this.connections.removeProject(projectId, connection);
      revokedWorkspaceIds.add(connection.workspaceId);
      close(connection.socket, 1008, "Project access revoked");
    }
    return revokedWorkspaceIds;
  }

  private async recheckLocalProjectAccess() {
    const userIds = new Set(
      this.connections
        .projectConnections(() => true)
        .map(({ connection }) => connection.userId),
    );
    await Promise.all(
      [...userIds].map(async (userId) => {
        for (const workspaceId of await this.revokeLocalProjectConnections(
          userId,
        )) {
          const payload = JSON.stringify({
            type: "PROJECT_ACCESS_CHANGED",
            workspaceId,
          });
          for (const { socket } of this.connections.users.get(userId) ?? []) {
            try {
              socket.send(payload);
            } catch {}
          }
        }
      }),
    );
  }
}
