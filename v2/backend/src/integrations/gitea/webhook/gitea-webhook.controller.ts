import { Controller, Param, Post, Req } from "@nestjs/common";
import { Public } from "../../../auth/public.decorator";
import { readRawBody } from "../../../billing/webhook/read-raw-body";
import type { RequestWithRawBody } from "../../../common/http/json-body-parser";
import { reply } from "../../../common/http/reply";
import { GiteaWebhookService } from "./gitea-webhook.service";

function header(request: RequestWithRawBody, name: string): string | undefined {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * Gitea's webhook deliveries. Public: Gitea proves itself with an HMAC of the
 * raw body under the integration's secret. Not part of the OpenAPI document.
 */
@Public()
@Controller("gitea-integration")
export class GiteaWebhookController {
  constructor(private readonly webhooks: GiteaWebhookService) {}

  @Post("webhook/:integrationId")
  async handle(
    @Param("integrationId") integrationId: string,
    @Req() request: RequestWithRawBody,
  ) {
    if (!integrationId) {
      return reply(400, { error: "Missing integration id" });
    }

    const body = (await readRawBody(request)).toString("utf8");
    const result = await this.webhooks.handle(
      integrationId,
      body,
      header(request, "x-gitea-signature"),
      header(request, "x-gitea-event") ?? header(request, "x-github-event"),
    );

    if (!result.success) {
      return reply(400, { error: result.error });
    }

    return reply(200, { status: "success" });
  }
}
