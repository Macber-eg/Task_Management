import { Controller, Param, Post, Req } from "@nestjs/common";
import { Public } from "../../../auth/public.decorator";
import { readRawBody } from "../../../billing/webhook/read-raw-body";
import type { RequestWithRawBody } from "../../../common/http/json-body-parser";
import { reply } from "../../../common/http/reply";
import { GitlabWebhookService } from "./gitlab-webhook.service";

/**
 * GitLab's webhook deliveries. Public: GitLab proves itself with the
 * integration's secret in `X-Gitlab-Token`. Not part of the OpenAPI document.
 */
@Public()
@Controller("gitlab-integration")
export class GitlabWebhookController {
  constructor(private readonly webhooks: GitlabWebhookService) {}

  @Post("webhook/:integrationId")
  async handle(
    @Param("integrationId") integrationId: string,
    @Req() request: RequestWithRawBody,
  ) {
    if (!integrationId) {
      return reply(400, { error: "Missing integration id" });
    }

    const body = (await readRawBody(request)).toString("utf8");
    const header = request.headers["x-gitlab-token"];
    const token = Array.isArray(header) ? header[0] : header;

    const result = await this.webhooks.handle(
      integrationId,
      body,
      token || undefined,
    );

    if (!result.success) {
      return reply(result.status ?? 400, { error: result.error });
    }

    return reply(200, { status: "success" });
  }
}
