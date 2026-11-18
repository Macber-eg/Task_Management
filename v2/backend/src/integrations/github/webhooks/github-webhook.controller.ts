import { Controller, Post, Req } from "@nestjs/common";
import { Public } from "../../../auth/public.decorator";
import { readRawBody } from "../../../billing/webhook/read-raw-body";
import type { RequestWithRawBody } from "../../../common/http/json-body-parser";
import { reply } from "../../../common/http/reply";
import { GitHubWebhookReceiver } from "./github-webhook-receiver";

/**
 * `POST /api/github-integration/webhook`: GitHub App deliveries. Public and
 * outside the OpenAPI document, as before; the signature over the raw body
 * authenticates it.
 */
@Controller("github-integration")
export class GitHubWebhookController {
  constructor(private readonly receiver: GitHubWebhookReceiver) {}

  @Public()
  @Post("webhook")
  async receive(@Req() request: RequestWithRawBody) {
    const body = (await readRawBody(request)).toString("utf8");

    const signature = request.get("x-hub-signature-256");
    if (!signature) return reply(400, { error: "Missing signature" });

    const eventName = request.get("x-github-event");
    if (!eventName) return reply(400, { error: "Missing event name" });

    const deliveryId = request.get("x-github-delivery") || "";

    const result = await this.receiver.receive(
      body,
      signature,
      eventName,
      deliveryId,
    );
    if (!result.success) return reply(400, { error: result.error });
    return reply(200, { status: "success" });
  }
}
