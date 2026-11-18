import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { ActivityEntity } from "../../../database/entities/activity.entity";
import type { GiteaClient } from "../client/gitea-client";
import type { GiteaComment } from "../client/gitea-types";
import { isKaneoComment } from "../comment-origin";
import type { GiteaConfig } from "../config";

/** Every comment of an issue, 100 per page. */
export async function fetchIssueComments(
  issueNumber: number,
  config: GiteaConfig,
  client: GiteaClient,
): Promise<GiteaComment[]> {
  const allComments: GiteaComment[] = [];
  let page = 1;

  while (true) {
    const comments = await client.listIssueComments(
      config.repositoryOwner,
      config.repositoryName,
      issueNumber,
      page,
      100,
    );

    if (comments.length === 0) break;

    allComments.push(...comments);

    if (comments.length < 100) break;
    page++;
  }

  return allComments;
}

/** Records the comments as task comment activities, skipping bots and Kaneo's own. */
export async function importCommentsForTask(
  tx: EntityManager,
  allComments: GiteaComment[],
  taskId: string,
): Promise<void> {
  for (const comment of allComments) {
    const username = comment.user?.login ?? comment.user?.username ?? "";
    if (username.endsWith("[bot]") || isKaneoComment(comment.body)) {
      continue;
    }

    await insertReturning(
      tx,
      ActivityEntity,
      {
        taskId,
        type: "comment",
        content: comment.body,
        externalUserName: username || "Unknown",
        externalUserAvatar: comment.user?.avatar_url ?? null,
        externalSource: "gitea",
        externalUrl: comment.html_url,
        eventData: { externalCommentId: comment.id },
      },
      {
        onConflict: { target: ["taskId", "externalSource", "externalUrl"] },
      },
    );
  }
}
