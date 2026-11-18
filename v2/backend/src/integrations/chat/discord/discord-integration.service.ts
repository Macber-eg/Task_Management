import { Injectable } from "@nestjs/common";
import { ProjectIntegrationStore } from "../shared/project-integration-store";
import { WebhookChannelIntegrations } from "../shared/webhook-channel-integrations";
import {
  defaultDiscordEvents,
  normalizeDiscordConfig,
  type DiscordConfig,
  validateDiscordConfig,
} from "./discord-config";

@Injectable()
export class DiscordIntegrationService extends WebhookChannelIntegrations<DiscordConfig> {
  constructor(store: ProjectIntegrationStore) {
    super(store, {
      type: "discord",
      label: "Discord",
      defaultEvents: defaultDiscordEvents,
      normalize: normalizeDiscordConfig,
      validate: validateDiscordConfig,
      maskEmptyAsBlank: true,
      upsert: true,
    });
  }
}
