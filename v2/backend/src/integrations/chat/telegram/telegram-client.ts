import { OutboundRequestError } from "../../../common/outbound/outbound-request-error";
import { sendOutboundRequest } from "../../../common/outbound/send-outbound-request";

export type TelegramMessage = {
  chat_id: string;
  text: string;
  parse_mode?: "HTML";
  disable_web_page_preview?: boolean;
  message_thread_id?: number;
};

/** The bot token is in the URL path, so failures never carry the URL. */
export async function postToTelegram(
  botToken: string,
  message: TelegramMessage,
): Promise<void> {
  const result = await sendOutboundRequest(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    },
    { readJson: true },
  );
  if (
    !result ||
    typeof result !== "object" ||
    !("ok" in result) ||
    result.ok !== true
  ) {
    throw new OutboundRequestError("response");
  }
}
