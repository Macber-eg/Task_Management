import { createHmac } from "node:crypto";
import { sendOutboundRequest } from "../../common/outbound/send-outbound-request";

const DELIVERY_OPTIONS = { publicDestination: true, timeoutMs: 15_000 };

export async function sendNtfyNotification(input: {
  serverUrl: string;
  topic: string;
  token?: string | null;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  await sendOutboundRequest(
    `${input.serverUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.topic)}`,
    {
      headers: {
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(input.clickUrl ? { Click: input.clickUrl } : {}),
        Title: input.title,
      },
      body: input.body,
    },
    DELIVERY_OPTIONS,
  );
}

export async function sendGotifyNotification(input: {
  serverUrl: string;
  token: string;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  // Gotify expects the app token in the query string; that can surface in logs, proxies, and browser history, so factor this into Gotify placement and log handling.
  await sendOutboundRequest(
    `${input.serverUrl.replace(/\/+$/, "")}/message?token=${encodeURIComponent(
      input.token,
    )}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        message: input.body,
        priority: 5,
        extras: input.clickUrl
          ? {
              "client::notification": {
                click: {
                  url: input.clickUrl,
                },
              },
              "client::display": {
                contentType: "text/plain",
              },
            }
          : undefined,
      }),
    },
    DELIVERY_OPTIONS,
  );
}

/** Signs the JSON body with HMAC-SHA256 in `X-Kaneo-Signature` when a secret is set. */
export async function sendWebhookNotification(input: {
  webhookUrl: string;
  secret?: string | null;
  payload: Record<string, unknown>;
}) {
  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.secret) {
    headers["X-Kaneo-Signature"] = createHmac("sha256", input.secret)
      .update(body)
      .digest("hex");
  }

  await sendOutboundRequest(
    input.webhookUrl,
    { headers, body },
    DELIVERY_OPTIONS,
  );
}
