import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { EventBus } from "../../../events/event-bus";
import { errorText } from "../../git-shared/error-text";
import type { GiteaConfig } from "../config";
import { handleGiteaIssueCommentCreated } from "../webhooks/issue-comment-created";
import { handleGiteaIssueEdited } from "../webhooks/issue-edited";
import { handleGiteaIssueLabeled } from "../webhooks/issue-labeled";
import { handleGiteaIssueOpened } from "../webhooks/issue-opened";
import { handleGiteaIssueState } from "../webhooks/issue-state";
import { handleGiteaLabelCreated } from "../webhooks/label-created";
import { handleGiteaPullRequestClosed } from "../webhooks/pull-request-closed";
import { handleGiteaPullRequestOpened } from "../webhooks/pull-request-opened";
import { handleGiteaPush } from "../webhooks/push";
import { verifyGiteaSignature } from "./verify-gitea-signature";

type Payload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const hasRepository = (payload: Payload) => isRecord(payload.repository);
const hasIssue = (payload: Payload) =>
  hasRepository(payload) && isRecord(payload.issue);
const hasPullRequest = (payload: Payload) =>
  hasRepository(payload) && isRecord(payload.pull_request);

/**
 * Verifies a Gitea delivery against its integration's webhook secret and
 * dispatches it by `X-Gitea-Event` and `action`.
 */
@Injectable()
export class GiteaWebhookService {
  private readonly logger = new Logger("GiteaWebhook");

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async handle(
    integrationId: string,
    rawBody: string,
    signatureHeader: string | undefined,
    eventHeader: string | undefined,
  ): Promise<{ success: boolean; error?: string }> {
    const integration = await this.dataSource.manager.findOne(
      IntegrationEntity,
      { where: { id: integrationId } },
    );

    if (integration?.type !== "gitea") {
      return { success: false, error: "Gitea integration not found" };
    }

    let config: GiteaConfig;
    try {
      config = JSON.parse(integration.config) as GiteaConfig;
    } catch {
      return { success: false, error: "Invalid integration config" };
    }

    const secret = config.webhookSecret;
    if (!secret) {
      return { success: false, error: "Webhook secret not configured" };
    }

    if (!verifyGiteaSignature(rawBody, secret, signatureHeader)) {
      return { success: false, error: "Invalid webhook signature" };
    }

    const event = eventHeader || undefined;
    if (!event) {
      return { success: false, error: "Missing event name" };
    }

    let payload: Payload;
    try {
      payload = JSON.parse(rawBody) as Payload;
    } catch {
      return { success: false, error: "Invalid JSON payload" };
    }

    try {
      await this.dispatch(event, payload, integration.id);
      return { success: true };
    } catch (error) {
      this.logger.error(`Gitea webhook handler error: ${errorText(error)}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Webhook handler failed",
      };
    }
  }

  private async dispatch(event: string, payload: Payload, integrationId: string) {
    const db = this.dataSource.manager;
    const events = this.events;
    const action = payload.action as string | undefined;
    // The handlers take their own payload types; only the shape checks below
    // vouch for the fields they read.
    const typed = payload as never;

    switch (event) {
      case "push":
        if (typeof payload.ref === "string" && hasRepository(payload)) {
          await handleGiteaPush(db, events, typed, integrationId);
        }
        return;
      case "pull_request":
        if (
          action === "opened" ||
          action === "reopened" ||
          action === "ready_for_review"
        ) {
          if (hasPullRequest(payload)) {
            await handleGiteaPullRequestOpened(db, events, typed, integrationId);
          }
        } else if (action === "closed" && hasPullRequest(payload)) {
          await handleGiteaPullRequestClosed(db, events, typed, integrationId);
        }
        return;
      case "issues":
        if (!hasIssue(payload)) return;
        // Gitea uses "created" for new issues; GitHub-style is "opened".
        if (action === "opened" || action === "created") {
          await handleGiteaIssueOpened(db, events, typed, integrationId);
        } else if (action === "reopened") {
          await handleGiteaIssueState(db, events, typed, "open", integrationId);
        } else if (action === "closed") {
          await handleGiteaIssueState(db, events, typed, "closed", integrationId);
        } else if (action === "edited") {
          await handleGiteaIssueEdited(db, events, typed, integrationId);
        } else if (
          action === "labeled" ||
          action === "unlabeled" ||
          action === "label_updated"
        ) {
          await handleGiteaIssueLabeled(
            db,
            events,
            { ...payload, action } as never,
            integrationId,
          );
        }
        return;
      case "issue_comment":
        if (
          action === "created" &&
          hasIssue(payload) &&
          isRecord(payload.comment)
        ) {
          await handleGiteaIssueCommentCreated(db, typed, integrationId);
        }
        return;
      case "issue_label":
        if (hasRepository(payload)) {
          await handleGiteaLabelCreated(db, typed, integrationId);
        }
        return;
      default:
        return;
    }
  }
}
