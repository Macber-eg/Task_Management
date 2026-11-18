import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  deleteWorkflowRuleRoute,
  getWorkflowRulesRoute,
  upsertWorkflowRuleRoute,
} from "./workflow-rule.routes";
import { WorkflowRuleService } from "./workflow-rule.service";

@Controller("workflow-rule")
export class WorkflowRuleController {
  constructor(private readonly rules: WorkflowRuleService) {}

  @ApiRoute(getWorkflowRulesRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  getWorkflowRules(@Input() input: RouteInput<typeof getWorkflowRulesRoute>) {
    return this.rules.getWorkflowRules(input.param.projectId);
  }

  @ApiRoute(upsertWorkflowRuleRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  upsertWorkflowRule(
    @Input() input: RouteInput<typeof upsertWorkflowRuleRoute>,
  ) {
    const { integrationType, eventType, columnId } = input.json;
    return this.rules.upsertWorkflowRule({
      projectId: input.param.projectId,
      integrationType,
      eventType,
      columnId,
    });
  }

  @ApiRoute(deleteWorkflowRuleRoute)
  @Access(
    workspaceAccess.fromWorkflowRule("id"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  deleteWorkflowRule(
    @Input() input: RouteInput<typeof deleteWorkflowRuleRoute>,
  ) {
    return this.rules.deleteWorkflowRule(input.param.id);
  }
}
