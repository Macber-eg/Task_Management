import { ActivityEntity } from "../../../database/entities/activity.entity";
import { insertReturning } from "../../../database/dml";
import { findExternalLink } from "../../links/external-link-queries";
import { withIntegrationLink } from "../../links/with-integration-link";
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";

export type IssueCommentCreatedPayload = {
  action: string;
  issue: { number: number };
  comment: {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; avatar_url: string } | null;
    created_at: string;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

/** A human comment on a linked issue becomes an external comment activity. */
export async function handleIssueCommentCreated(
  deps: GitHubDeps,
  payload: IssueCommentCreatedPayload,
): Promise<void> {
  const { issue, comment } = payload;
  if (payload.action !== "created") return;

  const username = comment.user?.login ?? "";
  if (username.endsWith("[bot]")) return;

  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const existingLink = await findExternalLink(
      deps.db,
      integration.id,
      "issue",
      issue.number.toString(),
    );
    if (!existingLink) continue;

    await withIntegrationLink(
      deps.db,
      existingLink,
      integration,
      async (tx, _afterCommit, lockedLink) => {
        await insertReturning(
          tx,
          ActivityEntity,
          {
            taskId: lockedLink.taskId,
            type: "comment",
            content: comment.body,
            externalUserName: comment.user?.login ?? "Unknown",
            externalUserAvatar: comment.user?.avatar_url ?? null,
            externalSource: "github",
            externalUrl: comment.html_url,
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
