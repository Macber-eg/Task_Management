import { Global, Module } from "@nestjs/common";
import { NoopRealtimeConnections } from "./noop-realtime-connections";
import { RealtimeConnections } from "./realtime-connections";

@Global()
@Module({
  providers: [
    { provide: RealtimeConnections, useClass: NoopRealtimeConnections },
  ],
  exports: [RealtimeConnections],
})
export class RealtimeModule {}
