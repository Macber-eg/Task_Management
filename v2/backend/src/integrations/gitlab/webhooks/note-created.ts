import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { ActivityEntity } from "../../../database/entities/activity.entity";
import { findExternalLink } from "../../links/external-link-queries";
import { withIntegrationLink } from "../../links/with-integration-link";
import { syncedNoteIds } from "../sync/synced-notes";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import type {
  GitlabWebhookProject,
  GitlabWebhookUser,
} from "../webhook/payload";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";

export type NoteCreatedPayload = {
  event_type?: string;
  user?: GitlabWebhookUser | null;
  object_attributes: {
    id: number;
    note: string;
    noteable_type: string;
    url: string;
    system?: boolean;
    internal?: boolean;
  };
  issue?: { iid: number };
  project: GitlabWebhookProject;
};

/** Records a public comment on a linked issue as an external task comment. */
export async function handleGitlabNoteCreated(
  db: EntityManager,
  payload: NoteCreatedPayload,
  integrationId?: string,
) {
  const note = payload.object_attributes;

  if (note.noteable_type !== "Issue" || !payload.issue) {
    return;
  }

  // System notes are label/state changes, not comments.
  if (note.system) {
    return;
  }

  // Internal and confidential notes are for project members only.
  if (note.internal || payload.event_type === "confidential_note") {
    return;
  }

  const baseUrl = baseUrlFromProjectWebUrl(
    payload.project.web_url,
    payload.project.path_with_namespace,
  );
  if (!baseUrl) return;

  const integrations = await findAllIntegrationsByGitlabProject(
    db,
    baseUrl,
    payload.project.path_with_namespace,
    integrationId,
  );

  const username = payload.user?.username ?? payload.user?.name ?? "";
  const issueIid = payload.issue.iid;

  for (const integration of integrations) {
    const externalLink = await findExternalLink(
      db,
      integration.id,
      "issue",
      issueIid.toString(),
    );

    if (!externalLink) {
      continue;
    }

    await withIntegrationLink(
      db,
      externalLink,
      integration,
      async (tx, _afterCommit, lockedLink) => {
        if (syncedNoteIds(lockedLink.metadata).includes(note.id)) {
          return;
        }

        await insertReturning(
          tx,
          ActivityEntity,
          {
            taskId: lockedLink.taskId,
            type: "comment",
            content: note.note,
            externalUserName: username || "Unknown",
            externalUserAvatar: payload.user?.avatar_url ?? null,
            externalSource: "gitlab",
            externalUrl: note.url,
            eventData: {
              externalCommentId: note.id,
            },
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
