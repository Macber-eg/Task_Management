import { constructWebhookEvent } from "creem/webhooks.js";
import type {
  BillingWebhookEvent,
  WebhookObject,
} from "./billing-webhook-event";

/**
 * Checks the Creem signature over the exact bytes received and parses the
 * event. Throws when the signature is missing, stale or wrong.
 */
export async function verifyBillingWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): Promise<BillingWebhookEvent> {
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const parsed = await constructWebhookEvent<WebhookObject>(
    payload,
    headers,
    secret,
  );
  return { id: parsed.id, type: parsed.type, data: parsed.data };
}
