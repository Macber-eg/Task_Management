import { describe, expect, it } from "vitest";
import { validateDiscordConfig } from "../discord/discord-config";
import { validateGenericWebhookConfig } from "../generic-webhook/generic-webhook-config";
import { validateSlackConfig } from "../slack/slack-config";
import {
  parseTelegramConfig,
  validateTelegramConfig,
} from "../telegram/telegram-config";

// Expected messages are the ones valibot 1.5 produced for the same input.
describe("integration config validation messages", () => {
  it("reports missing keys and wrong types like valibot", async () => {
    expect(await validateSlackConfig({})).toEqual({
      valid: false,
      errors: ['Invalid key: Expected "webhookUrl" but received undefined'],
    });
    expect(await validateSlackConfig({ webhookUrl: 5 })).toEqual({
      valid: false,
      errors: ["Invalid type: Expected string but received 5"],
    });
    expect(await validateSlackConfig(null)).toEqual({
      valid: false,
      errors: ["Invalid type: Expected Object but received null"],
    });
    expect(
      await validateSlackConfig({
        webhookUrl: "https://example.com/hook",
        events: { taskCreated: "yes" },
      }),
    ).toEqual({
      valid: false,
      errors: ["Invalid Slack webhook URL", 'Invalid type: Expected boolean but received "yes"'],
    });
  });

  it("keeps running pipe validations after the first failure", async () => {
    expect(await validateDiscordConfig({ webhookUrl: "" })).toEqual({
      valid: false,
      errors: ['Invalid URL: Received ""', "Enter a valid Discord webhook URL"],
    });
    expect(
      await validateDiscordConfig({
        webhookUrl: "https://discord.com/api/webhooks/1/token",
      }),
    ).toEqual({ valid: true });
  });

  it("surfaces the URL constructor error for an unparseable generic webhook", async () => {
    expect(await validateGenericWebhookConfig({ webhookUrl: "nope" })).toEqual({
      valid: false,
      errors: ["Invalid URL"],
    });
    expect(
      await validateGenericWebhookConfig({ webhookUrl: "ftp://example.com/x" }),
    ).toEqual({
      valid: false,
      errors: ["Webhook URL must use http or https"],
    });
    expect(
      await validateGenericWebhookConfig({
        webhookUrl: "https://example.com/x",
        dueDateReminderLeadTimeMinutes: 1.5,
      }),
    ).toEqual({
      valid: false,
      errors: [
        "Invalid integer: Received 1.5",
        "Invalid value: Expected >=5 but received 1.5",
      ],
    });
  });

  it("trims the Telegram chat and drops undeclared keys", () => {
    const token = `12345678:${"a".repeat(35)}`;
    expect(validateTelegramConfig({ botToken: "x", chatId: "  " })).toEqual({
      valid: false,
      errors: ["Enter a valid Telegram bot token", "Chat ID is required"],
    });
    expect(
      validateTelegramConfig({ botToken: token, chatId: "c", threadId: 0 }),
    ).toEqual({
      valid: false,
      errors: ["Invalid value: Expected >=1 but received 0"],
    });
    expect(
      parseTelegramConfig({ botToken: token, chatId: " c ", extra: true }),
    ).toEqual({ botToken: token, chatId: "c" });
  });
});
