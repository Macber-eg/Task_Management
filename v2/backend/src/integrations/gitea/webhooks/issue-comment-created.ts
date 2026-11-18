import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { ActivityEntity } from "../../../database/entities/activity.entity";
import { findExternalLink } from "../../links/external-link-queries";
import { withIntegrationLink } from "../../links/with-integration-link";
import { isKaneoComment } from "../comment-origin";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";

export type IssueCommentCreatedPayload = {
  action: string;
  issue: {
    number: number;
  };
  comment: {
    id: number;
    body: string;
    html_url: string;
    user: {
      login?: string;
      username?: string;
      avatar_url: string;
    } | null;
    created_at: string;
  };
  repository: GiteaWebhookRepository;
};

/** Records a Gitea issue comment as a task comment activity (once per comment URL). */
export async function handleGiteaIssueCommentCreated(
  db: EntityManager,
  payload: IssueCommentCreatedPayload,
  integrationId?: string,
): Promise<void> {
  const { issue, comment, repository } = payload;

  if (payload.action !== "created" || isKaneoComment(comment.body)) {
    return;
  }

  const username = comment.user?.login ?? comment.user?.username ?? "";
  if (username.endsWith("[bot]")) {
    return;
  }

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    const existingLink = await findExternalLink(
      db,
      integration.id,
      "issue",
      issue.number.toString(),
    );

    if (!existingLink) {
      continue;
    }

    await withIntegrationLink(
      db,
      existingLink,
      integration,
      async (tx, _afterCommit, locked) => {
        await insertReturning(
          tx,
          ActivityEntity,
          {
            taskId: locked.taskId,
            type: "comment",
            content: comment.body,
            externalUserName: username || "Unknown",
            externalUserAvatar: comment.user?.avatar_url ?? null,
            externalSource: "gitea",
            externalUrl: comment.html_url,
            eventData: { externalCommentId: comment.id },
          },
          {
            onConflict: {
              target: ["taskId", "externalSource", "externalUrl"],
            },
          },
        );
      },
    );
  }
}
