import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { ActivityEntity } from "../../../database/entities/activity.entity";
import type { GitlabClient } from "../client/gitlab-client";
import type { GitlabIssue, GitlabNote } from "../client/gitlab-types";

const PER_PAGE = 100;
const MAX_PAGES = 50;

export async function fetchIssueNotes(
  client: GitlabClient,
  projectPath: string,
  issue: GitlabIssue,
): Promise<GitlabNote[]> {
  const allNotes: GitlabNote[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const notes = await client.listIssueNotes(
      projectPath,
      issue.iid,
      page,
      PER_PAGE,
    );

    if (notes.length === 0) break;

    allNotes.push(...notes);
    if (notes.length < PER_PAGE) break;
  }
  return allNotes;
}

/** Records an issue's public notes as external task comments, once each. */
export async function importNotesForTask(
  db: EntityManager,
  issue: GitlabIssue,
  notes: GitlabNote[],
  taskId: string,
): Promise<void> {
  for (const note of notes) {
    // Skip system notes (label/state changes) and internal notes.
    if (note.system || note.internal) {
      continue;
    }

    const username = note.author?.username ?? note.author?.name ?? "";

    await insertReturning(
      db,
      ActivityEntity,
      {
        taskId,
        type: "comment",
        content: note.body,
        externalUserName: username || "Unknown",
        externalUserAvatar: note.author?.avatar_url ?? null,
        externalSource: "gitlab",
        // The notes API has no URL, so link to the anchor on the issue page.
        externalUrl: `${issue.web_url}#note_${note.id}`,
        eventData: {
          externalCommentId: note.id,
        },
      },
      {
        onConflict: { target: ["taskId", "externalSource", "externalUrl"] },
      },
    );
  }
}
