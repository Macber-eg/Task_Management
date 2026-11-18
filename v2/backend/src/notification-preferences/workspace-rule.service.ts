import { createId } from "@paralleldrive/cuid2";
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { UserNotificationPreferenceEntity } from "../database/entities/user-notification-preference.entity";
import { UserNotificationWorkspaceProjectEntity } from "../database/entities/user-notification-workspace-project.entity";
import { UserNotificationWorkspaceRuleEntity } from "../database/entities/user-notification-workspace-rule.entity";
import { WorkspaceUserEntity } from "../database/entities/workspace-user.entity";
import { findHiddenRuleProjectIds } from "./find-hidden-rule-project-ids";
import { NotificationPreferencesQueryService } from "./notification-preferences-query.service";
import type { NotificationPreferenceResponse } from "./response";
import type { UpsertWorkspaceRuleInput } from "./schema";

/** Per-workspace overrides of the global notification settings. */
@Injectable()
export class WorkspaceRuleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly query: NotificationPreferencesQueryService,
  ) {}

  async upsertWorkspaceRule(
    userId: string,
    workspaceId: string,
    emailAddress: string | null,
    input: UpsertWorkspaceRuleInput,
  ): Promise<NotificationPreferenceResponse> {
    const manager = this.dataSource.manager;
    await this.assertWorkspaceMembership(userId, workspaceId);

    const hiddenProjectIds =
      input.projectMode === "selected"
        ? await findHiddenRuleProjectIds(manager, userId, workspaceId)
        : [];
    const visibleProjectIds = (input.selectedProjectIds ?? []).filter(
      (projectId) => !hiddenProjectIds.includes(projectId),
    );
    if (input.projectMode === "selected") {
      await this.validateProjectSelection(
        userId,
        workspaceId,
        visibleProjectIds,
        hiddenProjectIds,
      );
    }

    const preference = await manager.findOne(UserNotificationPreferenceEntity, {
      where: { userId },
    });

    if (input.emailEnabled && (!preference?.emailEnabled || !emailAddress)) {
      throw new HTTPException(400, {
        message: "Enable email notifications globally before using them here",
      });
    }

    if (
      input.ntfyEnabled &&
      (!preference?.ntfyEnabled ||
        !preference.ntfyServerUrl ||
        !preference.ntfyTopic)
    ) {
      throw new HTTPException(400, {
        message: "Enable ntfy notifications globally before using them here",
      });
    }

    if (
      input.webhookEnabled &&
      (!preference?.webhookEnabled || !preference.webhookUrl)
    ) {
      throw new HTTPException(400, {
        message: "Enable webhook notifications globally before using them here",
      });
    }

    if (
      input.gotifyEnabled &&
      (!preference?.gotifyEnabled ||
        !preference.gotifyServerUrl ||
        !preference.gotifyToken)
    ) {
      throw new HTTPException(400, {
        message: "Enable Gotify notifications globally before using them here",
      });
    }

    const existing = await manager.findOne(
      UserNotificationWorkspaceRuleEntity,
      { where: { userId, workspaceId } },
    );

    const settings = {
      isActive: input.isActive,
      emailEnabled: input.emailEnabled,
      ntfyEnabled: input.ntfyEnabled,
      gotifyEnabled: input.gotifyEnabled,
      webhookEnabled: input.webhookEnabled,
      projectMode: input.projectMode,
    };

    let ruleId = existing?.id;

    if (existing) {
      await manager.update(
        UserNotificationWorkspaceRuleEntity,
        { id: existing.id },
        { ...settings, updatedAt: new Date() },
      );
    } else {
      const createdRule = await insertReturning(
        manager,
        UserNotificationWorkspaceRuleEntity,
        { userId, workspaceId, ...settings },
      );
      ruleId = createdRule?.id;
    }

    if (!ruleId) {
      throw new HTTPException(500, {
        message: "Failed to save notification workspace rule",
      });
    }

    await manager.delete(UserNotificationWorkspaceProjectEntity, {
      workspaceRuleId: ruleId,
    });

    if (input.projectMode === "selected") {
      const projectIds = [
        ...new Set([...visibleProjectIds, ...hiddenProjectIds]),
      ];
      await manager.query(
        `INSERT INTO user_notification_workspace_project (id, workspace_id, workspace_rule_id, project_id)
         SELECT selected.id, $1, $2, selected.project_id
         FROM unnest($3::text[], $4::text[]) AS selected(id, project_id)`,
        [workspaceId, ruleId, projectIds.map(() => createId()), projectIds],
      );
    }

    return this.query.getNotificationPreferences(userId, emailAddress);
  }

  async deleteWorkspaceRule(
    userId: string,
    workspaceId: string,
    emailAddress: string | null,
  ): Promise<NotificationPreferenceResponse> {
    const manager = this.dataSource.manager;
    await this.assertWorkspaceMembership(userId, workspaceId);

    const existing = await manager.findOne(
      UserNotificationWorkspaceRuleEntity,
      { where: { userId, workspaceId } },
    );

    if (!existing) {
      throw new HTTPException(404, {
        message: "Workspace notification rule not found",
      });
    }

    await manager.delete(UserNotificationWorkspaceRuleEntity, {
      id: existing.id,
    });

    return this.query.getNotificationPreferences(userId, emailAddress);
  }

  private async assertWorkspaceMembership(userId: string, workspaceId: string) {
    const membership = await this.dataSource.manager.findOne(
      WorkspaceUserEntity,
      { where: { userId, workspaceId }, select: { workspaceId: true } },
    );

    if (!membership) {
      throw new HTTPException(403, {
        message: "You don't have access to this workspace",
      });
    }
  }

  private async validateProjectSelection(
    userId: string,
    workspaceId: string,
    selectedProjectIds: string[],
    hiddenProjectIds: string[],
  ) {
    if (selectedProjectIds.length === 0 && hiddenProjectIds.length === 0) {
      throw new HTTPException(400, {
        message: "Select at least one project for selected project mode",
      });
    }

    const projects = (await this.dataSource.query(
      `SELECT p.id FROM project AS p
       WHERE p.workspace_id = $2
         AND p.id = ANY($3::text[])
         AND ${projectAccessCondition("$1", "p.id")}`,
      [userId, workspaceId, selectedProjectIds],
    )) as { id: string }[];

    if (projects.length !== new Set(selectedProjectIds).size) {
      throw new HTTPException(400, {
        message: "One or more selected projects are invalid",
      });
    }
  }
}
