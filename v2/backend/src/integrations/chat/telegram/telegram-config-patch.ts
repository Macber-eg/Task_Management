import {
  defaultTelegramEvents,
  type TelegramConfig,
  type TelegramEventKey,
} from "./telegram-config";

// The HTTP body is validated by updateTelegramBody in ./schema; this is the
// shape it produces. Every event toggle is genuinely optional -- a patch merges
// the toggles it carries over the stored ones and leaves the rest alone.
export type TelegramIntegrationPatchBody = {
  botToken?: string;
  chatId?: string;
  threadId?: number | null;
  chatLabel?: string | null;
  isActive?: boolean;
  events?: Partial<Record<TelegramEventKey, boolean>>;
};

export function buildNextTelegramConfigFromPatch(
  body: TelegramIntegrationPatchBody,
  currentConfig: TelegramConfig,
): TelegramConfig {
  const nextBotToken =
    "botToken" in body ? (body.botToken?.trim() ?? "") : currentConfig.botToken;
  const nextChatId =
    "chatId" in body ? (body.chatId?.trim() ?? "") : currentConfig.chatId;
  return {
    botToken: nextBotToken,
    chatId: nextChatId,
    threadId:
      body.threadId === undefined
        ? currentConfig.threadId
        : (body.threadId ?? undefined),
    chatLabel:
      body.chatLabel === undefined
        ? currentConfig.chatLabel
        : (body.chatLabel ?? undefined),
    events: {
      ...defaultTelegramEvents,
      ...currentConfig.events,
      ...body.events,
    },
  };
}
