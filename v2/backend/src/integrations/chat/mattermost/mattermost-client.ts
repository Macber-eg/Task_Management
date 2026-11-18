import { sendOutboundRequest } from "../../../common/outbound/send-outbound-request";

export type MattermostAttachment = {
  color?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
};

export type MattermostMessage = {
  text: string;
  attachments?: MattermostAttachment[];
};

/** Self-hosted servers: the destination is checked against private networks. */
export async function postToMattermost(
  webhookUrl: string,
  message: MattermostMessage,
): Promise<void> {
  await sendOutboundRequest(
    webhookUrl,
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    },
    { publicDestination: true },
  );
}
