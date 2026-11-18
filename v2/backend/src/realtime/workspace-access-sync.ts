import { Logger } from "@nestjs/common";
import type { RealtimeAccessReader } from "./realtime-access-reader";
import type { RealtimeSocket } from "./realtime-socket";

const logger = new Logger("WorkspaceAccessSync");

/**
 * Tells a user socket which workspaces it may still show, so a tab that was
 * offline during a removal drops what it lost.
 */
export async function syncWorkspaceAccess(
  reader: Pick<RealtimeAccessReader, "accessibleWorkspaceIds">,
  userId: string,
  socket: RealtimeSocket,
): Promise<void> {
  try {
    const workspaceIds = await reader.accessibleWorkspaceIds(userId);
    if (!workspaceIds) {
      socket.close(1008, "User access revoked");
      return;
    }
    socket.send(JSON.stringify({ type: "WORKSPACE_ACCESS_SYNC", workspaceIds }));
  } catch (error) {
    logger.error("Failed to synchronize workspace access:", error);
    socket.close(1011, "Workspace access synchronization failed");
  }
}
