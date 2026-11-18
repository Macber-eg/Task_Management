import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { AccessRule, AccessRuleHandler } from "../../access/access-rule";
import { WorkspacePermissionHandler } from "../../access/workspace-permission.handler";
import type { ApiRequest } from "../../auth/principal";
import { jsonBody } from "./json-body";

/** A full update that changes the assignee also needs task:assign. */
@Injectable()
export class TaskAssigneePermissionHandler implements AccessRuleHandler<void> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permission: WorkspacePermissionHandler,
  ) {}

  async check(request: ApiRequest): Promise<void> {
    const id = request.params.id;
    const { userId } = jsonBody(request);
    const nextAssignee = typeof userId === "string" ? userId : null;

    const [existingTask] = (await this.dataSource.query(
      `SELECT assignee_id AS "userId" FROM task WHERE id = $1 LIMIT 1`,
      [typeof id === "string" ? id : ""],
    )) as { userId: string | null }[];

    if (existingTask && existingTask.userId !== nextAssignee) {
      await this.permission.check(request, { task: ["assign"] });
    }
  }
}

export const requireTaskAssigneePermission: AccessRule<void> = {
  handler: TaskAssigneePermissionHandler,
  options: undefined,
};
