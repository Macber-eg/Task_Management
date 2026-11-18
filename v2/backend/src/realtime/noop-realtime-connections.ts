import { Injectable } from "@nestjs/common";
import { RealtimeConnections } from "./realtime-connections";

@Injectable()
export class NoopRealtimeConnections extends RealtimeConnections {
  async revokeUserConnections(): Promise<void> {}
  async revokeWorkspaceConnections(): Promise<void> {}
  async closeProjectConnections(): Promise<void> {}
  async revokeSessionConnections(): Promise<void> {}
}
