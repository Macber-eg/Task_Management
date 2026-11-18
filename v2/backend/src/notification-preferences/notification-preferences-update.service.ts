import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { UserNotificationPreferenceEntity } from "../database/entities/user-notification-preference.entity";
import { UserNotificationWorkspaceRuleEntity } from "../database/entities/user-notification-workspace-rule.entity";
import { assertDeliveryDestination } from "./assert-delivery-destination";
import { decryptPreference } from "./decrypted-preference";
import { NotificationPreferencesQueryService } from "./notification-preferences-query.service";
import {
  normalizeOptionalString,
  normalizeSecretInput,
} from "./preference-values";
import type { NotificationPreferenceResponse } from "./response";
import type { UpdateNotificationPreferenceInput } from "./schema";
import { encryptSecret } from "./secrets";

type WorkspaceRuleChannelState = {
  emailEnabled: boolean;
  ntfyEnabled: boolean;
  gotifyEnabled: boolean;
  webhookEnabled: boolean;
};

@Injectable()
export class NotificationPreferencesUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly query: NotificationPreferencesQueryService,
  ) {}

  /**
   * Saves the global settings. A channel turned off or left unconfigured is
   * turned off in every active workspace rule; a channel newly turned on is
   * turned on in the active rules that deliver through some channel.
   */
  async updateNotificationPreferences(
    userId: string,
    emailAddress: string | null,
    input: UpdateNotificationPreferenceInput,
  ): Promise<NotificationPreferenceResponse> {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(UserNotificationPreferenceEntity, {
      where: { userId },
    });

    const decryptedExisting = existing ? decryptPreference(existing) : null;

    const ntfyServerUrl = normalizeOptionalString(
      input.ntfyServerUrl ?? decryptedExisting?.ntfyServerUrl,
    );
    const ntfyTopic = normalizeOptionalString(
      input.ntfyTopic ?? decryptedExisting?.ntfyTopic,
    );
    const ntfyToken = normalizeSecretInput(
      input.ntfyToken,
      decryptedExisting?.ntfyToken,
    );
    const gotifyServerUrl = normalizeOptionalString(
      input.gotifyServerUrl ?? decryptedExisting?.gotifyServerUrl,
    );
    const gotifyToken = normalizeSecretInput(
      input.gotifyToken,
      decryptedExisting?.gotifyToken,
    );
    const webhookUrl = normalizeOptionalString(
      input.webhookUrl ?? decryptedExisting?.webhookUrl,
    );
    const webhookSecret = normalizeSecretInput(
      input.webhookSecret,
      decryptedExisting?.webhookSecret,
    );

    const emailEnabled =
      input.emailEnabled ?? decryptedExisting?.emailEnabled ?? false;
    const ntfyEnabled =
      input.ntfyEnabled ?? decryptedExisting?.ntfyEnabled ?? false;
    const gotifyEnabled =
      input.gotifyEnabled ?? decryptedExisting?.gotifyEnabled ?? false;
    const webhookEnabled =
      input.webhookEnabled ?? decryptedExisting?.webhookEnabled ?? false;

    const enabledRuleCascade: WorkspaceRuleChannelState = {
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
    };

    const shouldValidateNtfy =
      ntfyEnabled ||
      input.ntfyServerUrl !== undefined ||
      input.ntfyTopic !== undefined ||
      input.ntfyToken !== undefined;

    const shouldValidateGotify =
      gotifyEnabled ||
      input.gotifyServerUrl !== undefined ||
      input.gotifyToken !== undefined;

    const shouldValidateWebhook =
      webhookEnabled ||
      input.webhookUrl !== undefined ||
      input.webhookSecret !== undefined;

    if (emailEnabled && !emailAddress) {
      throw new HTTPException(400, {
        message: "Email notifications require an account email address",
      });
    }

    if (shouldValidateNtfy) {
      if (!ntfyServerUrl || !ntfyTopic) {
        throw new HTTPException(400, {
          message: "ntfy requires a server URL and topic",
        });
      }
      await assertDeliveryDestination(ntfyServerUrl, "Invalid ntfy server URL");
    }

    if (shouldValidateGotify) {
      if (!gotifyServerUrl || !gotifyToken) {
        throw new HTTPException(400, {
          message: "Gotify requires a server URL and app token",
        });
      }
      await assertDeliveryDestination(
        gotifyServerUrl,
        "Invalid Gotify server URL",
      );
    }

    if (shouldValidateWebhook) {
      if (!webhookUrl) {
        throw new HTTPException(400, {
          message: "Webhook notifications require an endpoint URL",
        });
      }
      await assertDeliveryDestination(webhookUrl, "Invalid webhook URL");
    }

    const data = {
      userId,
      emailEnabled,
      ntfyEnabled,
      ntfyServerUrl: ntfyServerUrl ?? null,
      ntfyTopic: ntfyTopic ?? null,
      ntfyToken:
        input.ntfyToken === undefined
          ? (existing?.ntfyToken ?? null)
          : (encryptSecret(ntfyToken) ?? null),
      gotifyEnabled,
      gotifyServerUrl: gotifyServerUrl ?? null,
      gotifyToken:
        input.gotifyToken === undefined
          ? (existing?.gotifyToken ?? null)
          : (encryptSecret(gotifyToken) ?? null),
      webhookEnabled,
      webhookUrl: webhookUrl ?? null,
      webhookSecret:
        input.webhookSecret === undefined
          ? (existing?.webhookSecret ?? null)
          : (encryptSecret(webhookSecret) ?? null),
      taskAssignmentEnabled:
        input.taskAssignmentEnabled ?? existing?.taskAssignmentEnabled ?? true,
      taskCommentEnabled:
        input.taskCommentEnabled ?? existing?.taskCommentEnabled ?? true,
      taskStatusChangeEnabled:
        input.taskStatusChangeEnabled ??
        existing?.taskStatusChangeEnabled ??
        true,
      dueDateReminderEnabled:
        input.dueDateReminderEnabled ??
        existing?.dueDateReminderEnabled ??
        true,
      dueDateReminderLeadTimeMinutes:
        input.dueDateReminderLeadTimeMinutes ??
        existing?.dueDateReminderLeadTimeMinutes ??
        1440,
    };

    if (existing) {
      await manager.update(
        UserNotificationPreferenceEntity,
        { userId },
        { ...data, updatedAt: new Date() },
      );
    } else {
      await insertReturning(manager, UserNotificationPreferenceEntity, data);
    }

    const ruleCascade: Partial<WorkspaceRuleChannelState> = {};

    const hadEmailEnabled = decryptedExisting?.emailEnabled ?? false;
    const hadNtfyEnabled = decryptedExisting?.ntfyEnabled ?? false;
    const hadGotifyEnabled = decryptedExisting?.gotifyEnabled ?? false;
    const hadWebhookEnabled = decryptedExisting?.webhookEnabled ?? false;

    if (!emailEnabled) {
      ruleCascade.emailEnabled = false;
    }

    if (!ntfyEnabled || !ntfyServerUrl || !ntfyTopic) {
      ruleCascade.ntfyEnabled = false;
    }

    if (!gotifyEnabled || !gotifyServerUrl || !data.gotifyToken) {
      ruleCascade.gotifyEnabled = false;
    }

    if (!webhookEnabled || !webhookUrl) {
      ruleCascade.webhookEnabled = false;
    }

    if (emailEnabled && !hadEmailEnabled && emailAddress) {
      enabledRuleCascade.emailEnabled = true;
    }

    if (ntfyEnabled && !hadNtfyEnabled && ntfyServerUrl && ntfyTopic) {
      enabledRuleCascade.ntfyEnabled = true;
    }

    if (
      gotifyEnabled &&
      !hadGotifyEnabled &&
      gotifyServerUrl &&
      data.gotifyToken
    ) {
      enabledRuleCascade.gotifyEnabled = true;
    }

    if (webhookEnabled && !hadWebhookEnabled && webhookUrl) {
      enabledRuleCascade.webhookEnabled = true;
    }

    const ruleEnableCascade = Object.fromEntries(
      Object.entries(enabledRuleCascade).filter(([, value]) => value),
    ) as Partial<WorkspaceRuleChannelState>;

    if (
      Object.keys(ruleCascade).length > 0 ||
      Object.keys(ruleEnableCascade).length > 0
    ) {
      await manager
        .createQueryBuilder()
        .update(UserNotificationWorkspaceRuleEntity)
        .set({ ...ruleEnableCascade, ...ruleCascade, updatedAt: new Date() })
        .where("user_id = :userId", { userId })
        .andWhere("is_active = true")
        .andWhere(
          "(email_enabled = true OR ntfy_enabled = true OR gotify_enabled = true OR webhook_enabled = true)",
        )
        .execute();
    }

    return this.query.getNotificationPreferences(userId, emailAddress);
  }
}
