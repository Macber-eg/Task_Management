import { Inject, Injectable, Logger } from "@nestjs/common";
import { Webhooks } from "@octokit/webhooks";
import { GITHUB_DEPS, type GitHubDeps } from "../github-deps";
import { handleIssueCommentCreated } from "./issue-comment-created";
import { handleIssueEdited } from "./issue-edited";
import { handleIssueLabeled } from "./issue-labeled";
import { handleIssueOpened } from "./issue-opened";
import { handleIssueStateChanged } from "./issue-state-changed";
import { handleLabelCreated } from "./label-created";
import { handlePullRequestClosed } from "./pull-request-closed";
import { handlePullRequestOpened } from "./pull-request-opened";
import { handlePush } from "./push";

type Handler = (deps: GitHubDeps, payload: never) => Promise<void>;

const handlers: Array<[event: string, handle: Handler]> = [
  ["issues.opened", handleIssueOpened],
  [
    "issues.closed",
    (deps, payload) => handleIssueStateChanged(deps, payload, "closed"),
  ],
  [
    "issues.reopened",
    (deps, payload) => handleIssueStateChanged(deps, payload, "open"),
  ],
  ["issues.labeled", handleIssueLabeled],
  ["issues.unlabeled", handleIssueLabeled],
  ["issues.edited", handleIssueEdited],
  ["push", handlePush],
  ["pull_request.opened", handlePullRequestOpened],
  ["pull_request.closed", handlePullRequestClosed],
  ["pull_request.reopened", handlePullRequestOpened],
  ["label.created", handleLabelCreated],
  ["issue_comment.created", handleIssueCommentCreated],
];

/**
 * Verifies a GitHub delivery's signature (`GITHUB_WEBHOOK_SECRET`) over the
 * raw body and runs the matching handler. A handler failure fails the
 * delivery, so GitHub retries it.
 */
@Injectable()
export class GitHubWebhookReceiver {
  private readonly logger = new Logger(GitHubWebhookReceiver.name);
  private webhooks: { secret: string; instance: Webhooks } | undefined;

  constructor(@Inject(GITHUB_DEPS) private readonly deps: GitHubDeps) {}

  async receive(
    body: string,
    signature: string,
    eventName: string,
    deliveryId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!this.deps.github.app() || !secret) {
      this.logger.error("GitHub App not configured");
      return { success: false, error: "GitHub integration not configured" };
    }

    try {
      await this.instance(secret).verifyAndReceive({
        id: deliveryId,
        name: eventName,
        signature,
        payload: body,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(
        `GitHub webhook ${eventName} (${deliveryId}) failed: ${String(error)}`,
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Webhook verification failed",
      };
    }
  }

  private instance(secret: string): Webhooks {
    if (this.webhooks?.secret === secret) return this.webhooks.instance;
    const instance = new Webhooks({ secret });
    for (const [event, handle] of handlers) {
      instance.on(event as "push", ({ payload }) =>
        handle(this.deps, payload as never),
      );
    }
    this.webhooks = { secret, instance };
    return instance;
  }
}
