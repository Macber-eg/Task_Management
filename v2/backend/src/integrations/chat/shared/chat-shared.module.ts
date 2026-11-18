import { Module } from "@nestjs/common";
import { ChatTaskReader } from "./chat-task-reader";
import { ProjectIntegrationStore } from "./project-integration-store";

@Module({
  providers: [ChatTaskReader, ProjectIntegrationStore],
  exports: [ChatTaskReader, ProjectIntegrationStore],
})
export class ChatSharedModule {}
