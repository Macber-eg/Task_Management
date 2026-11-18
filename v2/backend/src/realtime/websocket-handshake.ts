import type { IncomingMessage } from "node:http";
import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceMembershipService } from "../access/workspace-membership.service";
import { ProjectAccessService } from "../access/project-access.service";
import { Authenticator } from "../auth/authenticator";
import type { Principal } from "../auth/principal";
import { HTTPException } from "../common/errors/http-exception";
import { RealtimeAccessReader } from "./realtime-access-reader";
import { asUpgradeRequest, upgradeHeaders } from "./upgrade-request";
import { assertWebSocketOrigin } from "./websocket-origin";
import type { WebSocketRoute } from "./websocket-route";

export type AcceptedHandshake =
  | { kind: "user"; principal: Principal }
  | {
      kind: "project";
      principal: Principal;
      projectId: string;
      workspaceId: string;
      initiatorId: string;
    };

/**
 * Decides whether an upgrade may become a socket, in the previous API's
 * order: authentication, then the browser origin, then for a board the
 * project's workspace membership and project access.
 */
@Injectable()
export class WebSocketHandshake {
  private readonly logger = new Logger(WebSocketHandshake.name);

  constructor(
    private readonly authenticator: Authenticator,
    private readonly reader: RealtimeAccessReader,
    private readonly membership: WorkspaceMembershipService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async accept(
    incoming: IncomingMessage,
    route: WebSocketRoute,
  ): Promise<AcceptedHandshake> {
    const principal = await this.authenticate(incoming);
    assertWebSocketOrigin(upgradeHeaders(incoming));
    if (route.kind === "user") return { kind: "user", principal };

    const { userId } = principal;
    const workspaceId = await this.reader.projectWorkspaceId(route.projectId);
    if (!workspaceId) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    await this.membership.validateWorkspaceAccess(
      userId,
      workspaceId,
      undefined,
      { notFoundMessage: "Project not found" },
    );
    await this.projectAccess.assertProjectAccess(userId, route.projectId);

    return {
      kind: "project",
      principal,
      projectId: route.projectId,
      workspaceId,
      initiatorId: route.windowId ? `${userId}:${route.windowId}` : userId,
    };
  }

  private async authenticate(incoming: IncomingMessage): Promise<Principal> {
    let principal: Principal | null;
    try {
      principal = await this.authenticator.authenticate(
        asUpgradeRequest(incoming),
      );
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      this.logger.error("API authentication failed", error);
      throw new HTTPException(500, { message: "Internal Server Error" });
    }
    if (!principal) throw new HTTPException(401, { message: "Unauthorized" });
    return principal;
  }
}
