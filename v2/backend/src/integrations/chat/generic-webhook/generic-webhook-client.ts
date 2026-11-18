import { createHmac } from "node:crypto";
import { sendOutboundRequest } from "../../../common/outbound/send-outbound-request";

/** POSTs the JSON payload, signed with `X-Kaneo-Signature` when a secret is set. */
export async function postToGenericWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
  secret?: string,
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    headers["X-Kaneo-Signature"] = createHmac("sha256", secret)
      .update(body)
      .digest("hex");
  }

  await sendOutboundRequest(
    webhookUrl,
    { headers, body },
    { publicDestination: true },
  );
}
