import { Module } from "@nestjs/common";
import { WorkflowRuleController } from "./workflow-rule.controller";
import { WorkflowRuleService } from "./workflow-rule.service";

@Module({
  controllers: [WorkflowRuleController],
  providers: [WorkflowRuleService],
})
export class WorkflowRuleModule {}
