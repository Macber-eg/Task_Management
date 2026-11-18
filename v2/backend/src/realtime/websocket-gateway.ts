import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { type WebSocket, WebSocketServer } from "ws";
import { HTTPException } from "../common/errors/http-exception";
import {
  handleKeepaliveMessage,
  MAX_WEBSOCKET_MESSAGE_BYTES,
} from "./keepalive-message";
import { RealtimeHub } from "./realtime-hub";
import { rejectUpgrade } from "./reject-upgrade";
import { type AcceptedHandshake, WebSocketHandshake } from "./websocket-handshake";
import { parseWebSocketRoute } from "./websocket-route";

/**
 * Serves `/api/ws/user` and `/api/ws/:projectId` on the HTTP server's
 * upgrade event. Express never sees these requests.
 */
@Injectable()
export class WebSocketGateway
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WebSocketGateway.name);
  private server: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    void this.upgrade(request, socket, head);
  };

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly handshake: WebSocketHandshake,
    private readonly hub: RealtimeHub,
  ) {}

  onApplicationBootstrap(): void {
    // Absent when the application runs without an HTTP server.
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer() as
      | Server
      | undefined;
    if (!httpServer) return;
    this.server = new WebSocketServer({
      noServer: true,
      // Enforced by the receiver before a frame, or the sum of a fragmented
      // message's frames, is buffered.
      maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    this.httpServer = httpServer;
    httpServer.on("upgrade", this.onUpgrade);
  }

  // Before the HTTP server closes, as the previous API shut its broadcast
  // adapter down first: open sockets would otherwise keep the server open.
  async beforeApplicationShutdown(): Promise<void> {
    this.httpServer?.off("upgrade", this.onUpgrade);
    this.httpServer = null;
    await this.hub.stop();
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // Node stops listening for socket errors once it hands over an upgrade.
    const onSocketError = () => socket.destroy();
    socket.on("error", onSocketError);

    const route = parseWebSocketRoute(request.url ?? "/");
    if (request.method !== "GET" || !route) {
      rejectUpgrade(socket, 404);
      return;
    }

    let accepted: AcceptedHandshake;
    try {
      accepted = await this.handshake.accept(request, route);
    } catch (error) {
      if (!(error instanceof HTTPException)) {
        this.logger.error("WebSocket handshake failed", error);
      }
      rejectUpgrade(socket, error instanceof HTTPException ? error.status : 500);
      return;
    }
    const server = this.server;
    if (request.headers.upgrade?.toLowerCase() !== "websocket" || !server) {
      rejectUpgrade(socket, 404);
      return;
    }
    if (socket.destroyed) return;

    socket.off("error", onSocketError);
    server.handleUpgrade(request, socket, head, (ws) => this.open(ws, accepted));
  }

  private open(ws: WebSocket, accepted: AcceptedHandshake) {
    // Protocol errors (an oversized frame, say) close the socket themselves.
    ws.on("error", () => {});
    ws.on("message", (data, isBinary) =>
      handleKeepaliveMessage(data, isBinary, ws),
    );

    const { userId, session } = accepted.principal;
    const sessionId = session?.id ?? null;
    if (accepted.kind === "user") {
      const connection = this.hub.addUserConnection(userId, ws, sessionId);
      void this.hub.syncWorkspaceAccess(userId, ws);
      ws.on("close", () => this.hub.removeUserConnection(userId, connection));
      return;
    }

    const { projectId, workspaceId, initiatorId } = accepted;
    const connection = this.hub.addProjectConnection(projectId, ws, {
      userId,
      initiatorId,
      workspaceId,
      sessionId,
    });
    ws.on("close", () => this.hub.removeProjectConnection(projectId, connection));
  }
}
