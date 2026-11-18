import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { EventBus } from "../../../events/event-bus";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import { handleGitlabIssueOpened } from "../webhooks/issue-opened";
import {
  handleGitlabIssueClosed,
  handleGitlabIssueReopened,
  type IssueStatePayload,
} from "../webhooks/issue-state";
import {
  handleGitlabIssueUpdated,
  type IssueUpdatedPayload,
} from "../webhooks/issue-updated";
import {
  handleGitlabMergeRequestClosed,
  type MergeRequestClosedPayload,
} from "../webhooks/merge-request-closed";
import {
  handleGitlabMergeRequestOpened,
  type MergeRequestOpenedPayload,
} from "../webhooks/merge-request-opened";
import {
  handleGitlabNoteCreated,
  type NoteCreatedPayload,
} from "../webhooks/note-created";
import { handleGitlabPush, type PushPayload } from "../webhooks/push";
import type { IssueOpenedPayload } from "../webhooks/issue-opened";
import { verifyWebhookToken } from "./verify-token";

export type GitlabWebhookResult = {
  success: boolean;
  error?: string;
  status?: 400 | 500;
};

type Payload = Record<string, unknown>;

function isRecord(value: unknown): value is Payload {
  return typeof value === "object" && value !== null;
}

function hasProject(value: Payload) {
  return isRecord(value.project);
}

function hasObjectAttributes(value: Payload) {
  return isRecord(value.object_attributes);
}

function isConfidentialIssue(payload: Payload): boolean {
  const attributes = payload.object_attributes;
  return (
    payload.event_type === "confidential_issue" ||
    (isRecord(attributes) && attributes.confidential === true)
  );
}

function objectAction(payload: Payload): string | undefined {
  const attributes = payload.object_attributes;
  if (!isRecord(attributes)) return undefined;
  return typeof attributes.action === "string" ? attributes.action : undefined;
}

/** Which way an "update" moved the draft flag, or null when it did not. */
function draftChange(payload: Payload): "entered" | "left" | null {
  const changes = payload.changes;
  if (!isRecord(changes)) return null;
  const draft = changes.draft;
  if (!isRecord(draft) || draft.previous === draft.current) return null;
  return draft.current === true ? "entered" : "left";
}

/**
 * Authenticates a GitLab webhook delivery by the integration's secret token
 * and routes it to the issue, merge request, note or push handler.
 */
@Injectable()
export class GitlabWebhookService {
  private readonly logger = new Logger("GitlabWebhook");

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async handle(
    integrationId: string,
    rawBody: string,
    tokenHeader: string | undefined,
  ): Promise<GitlabWebhookResult> {
    const integration = await this.dataSource.manager.findOne(
      IntegrationEntity,
      { where: { id: integrationId } },
    );

    if (integration?.type !== "gitlab") {
      return { success: false, error: "GitLab integration not found" };
    }

    let config: GitlabConfig;
    try {
      config = JSON.parse(integration.config) as GitlabConfig;
    } catch {
      return { success: false, error: "Invalid integration config" };
    }

    const secret = config.webhookSecret;
    if (!secret) {
      return { success: false, error: "Webhook secret not configured" };
    }

    if (!verifyWebhookToken(secret, tokenHeader)) {
      return { success: false, error: "Invalid webhook token" };
    }

    let payload: Payload;
    try {
      payload = JSON.parse(rawBody) as Payload;
    } catch {
      return { success: false, error: "Invalid JSON payload" };
    }

    const objectKind =
      typeof payload.object_kind === "string" ? payload.object_kind : undefined;

    if (!objectKind) {
      return { success: false, error: "Missing object_kind" };
    }

    try {
      await this.dispatch(objectKind, payload, integration.id);
      return { success: true };
    } catch (error) {
      this.logger.error(`Handler error: ${errorText(error)}`);
      // The request itself was valid; the details stay in the server log.
      return { success: false, error: "Webhook handler failed", status: 500 };
    }
  }

  private async dispatch(
    objectKind: string,
    payload: Payload,
    integrationId: string,
  ) {
    const db = this.dataSource.manager;
    this.logger.log(`Event: ${objectKind}`);

    switch (objectKind) {
      case "push":
        if (typeof payload.ref === "string" && hasProject(payload)) {
          await handleGitlabPush(
            db,
            this.events,
            payload as unknown as PushPayload,
            integrationId,
          );
        }
        return;
      case "issue": {
        if (
          !hasProject(payload) ||
          !hasObjectAttributes(payload) ||
          isConfidentialIssue(payload)
        ) {
          return;
        }
        switch (objectAction(payload)) {
          case "open":
            await handleGitlabIssueOpened(
              db,
              this.events,
              payload as unknown as IssueOpenedPayload,
              integrationId,
            );
            return;
          case "close":
            await handleGitlabIssueClosed(
              db,
              this.events,
              payload as unknown as IssueStatePayload,
              integrationId,
            );
            return;
          case "reopen":
            await handleGitlabIssueReopened(
              db,
              this.events,
              payload as unknown as IssueStatePayload,
              integrationId,
            );
            return;
          case "update":
            await handleGitlabIssueUpdated(
              db,
              this.events,
              payload as unknown as IssueUpdatedPayload,
              integrationId,
            );
            return;
          default:
            return;
        }
      }
      case "merge_request": {
        if (!hasProject(payload) || !hasObjectAttributes(payload)) {
          return;
        }
        const mergeRequest = payload as unknown as MergeRequestOpenedPayload;
        const action = objectAction(payload);
        if (action === "open" || action === "reopen") {
          await handleGitlabMergeRequestOpened(
            db,
            this.events,
            mergeRequest,
            integrationId,
            { moveTask: mergeRequest.object_attributes.draft !== true },
          );
          return;
        }
        if (action === "update") {
          const change = draftChange(payload);
          if (change) {
            await handleGitlabMergeRequestOpened(
              db,
              this.events,
              mergeRequest,
              integrationId,
              { moveTask: change === "left" },
            );
          }
          return;
        }
        if (action === "merge" || action === "close") {
          await handleGitlabMergeRequestClosed(
            db,
            this.events,
            payload as unknown as MergeRequestClosedPayload,
            integrationId,
          );
        }
        return;
      }
      case "note": {
        if (hasProject(payload) && hasObjectAttributes(payload)) {
          await handleGitlabNoteCreated(
            db,
            payload as unknown as NoteCreatedPayload,
            integrationId,
          );
        }
        return;
      }
      default:
        this.logger.log(`Ignored event: ${objectKind}`);
    }
  }
}
