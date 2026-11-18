import { sendOutboundRequest } from "../../../common/outbound/send-outbound-request";

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: {
    text: string;
  };
};

export type DiscordMessage = {
  content?: string;
  embeds?: DiscordEmbed[];
};

/** The URL is pinned to discord.com webhooks by the config schema. */
export async function postToDiscord(
  webhookUrl: string,
  message: DiscordMessage,
): Promise<void> {
  await sendOutboundRequest(webhookUrl, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}
