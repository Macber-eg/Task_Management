import type { ActivityEntity } from "../../database/entities/activity.entity";
import type { ImportedComment, ImportSourceId } from "../../importers";
import { parseImportDate } from "./plan-import-tasks";

type TaskComments = { id: string; comments: readonly ImportedComment[] };

export type PlannedImportComment = Pick<
  ActivityEntity,
  | "taskId"
  | "type"
  | "userId"
  | "content"
  | "externalUserName"
  | "externalSource"
  | "createdAt"
>;

const MAX_EXTERNAL_NAME_LENGTH = 120;

/** Comment activities attributed to the importer, naming the original author. */
export function planImportComments({
  tasks,
  importedBy,
  source,
  now,
}: {
  tasks: readonly TaskComments[];
  importedBy: string;
  source: ImportSourceId;
  now: Date;
}): PlannedImportComment[] {
  return tasks.flatMap(({ id: taskId, comments }) =>
    comments
      .filter((comment) => comment.body.trim())
      .map((comment) => ({
        taskId,
        type: "comment",
        userId: importedBy,
        content: comment.body,
        externalUserName: (
          comment.author.name?.trim() ||
          comment.author.email?.trim() ||
          "Unknown user"
        ).slice(0, MAX_EXTERNAL_NAME_LENGTH),
        externalSource: source,
        createdAt: parseImportDate(comment.createdAt) ?? now,
      })),
  );
}
