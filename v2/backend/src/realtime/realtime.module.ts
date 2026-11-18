import { Global, Module } from "@nestjs/common";
import { BroadcastAdapterFactory } from "./broadcast-adapter-factory";
import { RealtimeAccessReader } from "./realtime-access-reader";
import { RealtimeConnections } from "./realtime-connections";
import { RealtimeEventSubscriptions } from "./realtime-event-subscriptions";
import { RealtimeHub } from "./realtime-hub";
import { WebSocketGateway } from "./websocket-gateway";
import { WebSocketHandshake } from "./websocket-handshake";

@Global()
@Module({
  providers: [
    BroadcastAdapterFactory,
    RealtimeAccessReader,
    RealtimeHub,
    { provide: RealtimeConnections, useExisting: RealtimeHub },
    RealtimeEventSubscriptions,
    WebSocketHandshake,
    WebSocketGateway,
  ],
  exports: [RealtimeConnections, RealtimeHub],
})
export class RealtimeModule {}
