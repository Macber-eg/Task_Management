import { Logger } from "@nestjs/common";
import type { RealtimeAccessReader } from "./realtime-access-reader";

export type BroadcastAccess = {
  /** The project's current workspace, or null if the project is gone. */
  workspaceId: string | null;
  /** Recipients who are members of it, or instance admins. */
  members: Set<string>;
  /** Recipients the project is hidden from. */
  restricted: Set<string>;
};

type Reader = Pick<
  RealtimeAccessReader,
  | "projectWorkspaceId"
  | "workspaceMemberIds"
  | "usersWithProjectAccess"
  | "instanceAdminIds"
>;

/**
 * Re-checks, before every delivery, that each listener may still see the
 * project: a missed revocation must not leave a socket receiving updates.
 * Deliveries of one flush share a single check.
 */
export class BroadcastAuthorization {
  private readonly logger = new Logger(BroadcastAuthorization.name);
  private readonly workspaceLookups = new Map<string, Promise<string | null>>();
  private readonly lookups = new Map<string, Promise<BroadcastAccess | null>>();

  constructor(private readonly reader: Reader) {}

  /** Null when the check itself failed: skip delivery, revoke nothing. */
  check(
    projectId: string,
    recipientIds: readonly string[],
    authorizationBatch: string,
  ): Promise<BroadcastAccess | null> {
    const userIds = [...new Set(recipientIds)].sort();
    const key = JSON.stringify([projectId, authorizationBatch, userIds]);
    let pending = this.lookups.get(key);
    if (!pending) {
      pending = this.lookup(projectId, userIds).finally(() =>
        this.lookups.delete(key),
      );
      this.lookups.set(key, pending);
    }
    return pending;
  }

  private async lookup(
    projectId: string,
    userIds: string[],
  ): Promise<BroadcastAccess | null> {
    let workspaceId: string | null;
    try {
      workspaceId = await this.currentWorkspace(projectId);
    } catch (error) {
      this.logger.error("Failed to validate project broadcast access:", error);
      return null;
    }
    const members = new Set<string>();
    let restricted = new Set<string>();
    if (workspaceId) {
      try {
        const [memberIds, permitted] = await Promise.all([
          this.reader.workspaceMemberIds(workspaceId, userIds),
          this.reader.usersWithProjectAccess(userIds, projectId),
        ]);
        for (const id of memberIds) members.add(id);
        restricted = new Set(userIds.filter((userId) => !permitted.has(userId)));
        const nonmembers = userIds.filter((userId) => !members.has(userId));
        if (nonmembers.length > 0) {
          for (const id of await this.reader.instanceAdminIds(nonmembers))
            members.add(id);
        }
      } catch (error) {
        this.logger.error("Failed to validate broadcast membership:", error);
        return null;
      }
    }
    return { workspaceId, members, restricted };
  }

  private currentWorkspace(projectId: string): Promise<string | null> {
    let pending = this.workspaceLookups.get(projectId);
    if (!pending) {
      pending = this.reader
        .projectWorkspaceId(projectId)
        .finally(() => this.workspaceLookups.delete(projectId));
      this.workspaceLookups.set(projectId, pending);
    }
    return pending;
  }
}
