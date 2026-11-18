import { sendOutboundRequest } from "../../../common/outbound/send-outbound-request";

export type SlackTextObject = {
  type: "mrkdwn" | "plain_text";
  text: string;
};

export type SlackBlock =
  | {
      type: "section";
      text: SlackTextObject;
      fields?: SlackTextObject[];
    }
  | {
      type: "context";
      elements: SlackTextObject[];
    };

export type SlackMessage = {
  text: string;
  blocks?: SlackBlock[];
};

/** The URL is pinned to hooks.slack.com by the config schema. */
export async function postToSlack(
  webhookUrl: string,
  message: SlackMessage,
): Promise<void> {
  await sendOutboundRequest(webhookUrl, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}
