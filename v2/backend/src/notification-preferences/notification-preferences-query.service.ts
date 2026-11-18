import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ProjectAccessService } from "../access/project-access.service";
import { UserNotificationPreferenceEntity } from "../database/entities/user-notification-preference.entity";
import { UserNotificationWorkspaceRuleEntity } from "../database/entities/user-notification-workspace-rule.entity";
import { decryptPreference } from "./decrypted-preference";
import { maskValue } from "./preference-values";
import type { NotificationPreferenceResponse } from "./response";

@Injectable()
export class NotificationPreferencesQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * The user's settings with defaults filled in. Projects selected in a rule
   * that the user can no longer see are left out (but kept in storage).
   */
  async getNotificationPreferences(
    userId: string,
    emailAddress: string | null,
  ): Promise<NotificationPreferenceResponse> {
    const manager = this.dataSource.manager;
    const preference = await manager.findOne(UserNotificationPreferenceEntity, {
      where: { userId },
    });

    const decrypted = preference ? decryptPreference(preference) : null;

    const rules = await manager.find(UserNotificationWorkspaceRuleEntity, {
      where: { userId },
      relations: { workspace: true, selectedProjects: true },
      order: { createdAt: "ASC" },
    });
    const hiddenProjectIds = new Set(
      await this.projectAccess.findInaccessibleProjectIds(
        userId,
        rules.flatMap((rule) =>
          (rule.selectedProjects ?? []).map((project) => project.projectId),
        ),
      ),
    );

    return {
      emailAddress,
      emailEnabled: decrypted?.emailEnabled ?? false,
      ntfyEnabled: decrypted?.ntfyEnabled ?? false,
      ntfyConfigured: Boolean(decrypted?.ntfyServerUrl && decrypted?.ntfyTopic),
      ntfyServerUrl: decrypted?.ntfyServerUrl ?? null,
      ntfyTopic: decrypted?.ntfyTopic ?? null,
      ntfyTokenConfigured: Boolean(decrypted?.ntfyToken),
      maskedNtfyToken: maskValue(decrypted?.ntfyToken),
      gotifyEnabled: decrypted?.gotifyEnabled ?? false,
      gotifyConfigured: Boolean(
        decrypted?.gotifyServerUrl && decrypted?.gotifyToken,
      ),
      gotifyServerUrl: decrypted?.gotifyServerUrl ?? null,
      gotifyTokenConfigured: Boolean(decrypted?.gotifyToken),
      maskedGotifyToken: maskValue(decrypted?.gotifyToken),
      webhookEnabled: decrypted?.webhookEnabled ?? false,
      webhookConfigured: Boolean(decrypted?.webhookUrl),
      webhookUrl: decrypted?.webhookUrl ?? null,
      webhookSecretConfigured: Boolean(decrypted?.webhookSecret),
      maskedWebhookSecret: maskValue(decrypted?.webhookSecret),
      taskAssignmentEnabled: preference?.taskAssignmentEnabled ?? true,
      taskCommentEnabled: preference?.taskCommentEnabled ?? true,
      taskStatusChangeEnabled: preference?.taskStatusChangeEnabled ?? true,
      dueDateReminderEnabled: preference?.dueDateReminderEnabled ?? true,
      dueDateReminderLeadTimeMinutes:
        preference?.dueDateReminderLeadTimeMinutes ?? 1440,
      workspaces: rules.map((rule) => ({
        id: rule.id,
        workspaceId: rule.workspaceId,
        workspaceName: rule.workspace?.name ?? "",
        isActive: rule.isActive ?? true,
        emailEnabled: rule.emailEnabled ?? false,
        ntfyEnabled: rule.ntfyEnabled ?? false,
        gotifyEnabled: rule.gotifyEnabled ?? false,
        webhookEnabled: rule.webhookEnabled ?? false,
        projectMode:
          rule.projectMode === "selected" ? "selected" : ("all" as const),
        selectedProjectIds: (rule.selectedProjects ?? [])
          .map((project) => project.projectId)
          .filter((projectId) => !hiddenProjectIds.has(projectId)),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })),
      createdAt: preference?.createdAt ?? null,
      updatedAt: preference?.updatedAt ?? null,
    };
  }
}
