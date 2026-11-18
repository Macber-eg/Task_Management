import type { EntityManager } from "typeorm";
import { getActivitySearchContent } from "./activity-search-content";
import type { SearchResult, SearchScope } from "./search-result";
import { SqlParameters } from "./sql-parameters";
import { workspaceFilter } from "./workspace-filter";

type ActivityRow = {
  id: string;
  type: string;
  content: string | null;
  eventData: unknown;
  taskTitle: string | null;
  taskNumber: number | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
  relevanceScore: number;
};

const SEARCHABLE_TEXT = `COALESCE(activity.content, CAST(activity.event_data AS text), '')`;

/** Comments and other activity, matched on their text or their task's title. */
export async function searchActivities(
  manager: EntityManager,
  scope: SearchScope,
  commentsOnly: boolean,
): Promise<SearchResult[]> {
  const parameters = new SqlParameters();
  const filter = workspaceFilter(scope, parameters);
  const project = scope.projectId
    ? `AND task.project_id = ${parameters.add(scope.projectId)}`
    : "";
  const relevance = `CASE
      WHEN LOWER(${SEARCHABLE_TEXT}) LIKE ${parameters.add(scope.pattern)} THEN 2
      WHEN LOWER(task.title) LIKE ${parameters.add(scope.pattern)} THEN 1
      ELSE 1
    END`;
  const textMatch = parameters.add(scope.pattern);
  const titleMatch = parameters.add(scope.pattern);
  const limit = parameters.add(scope.limit);
  const activities = (await manager.query(
    `SELECT activity.id, activity.type, activity.content,
            activity.event_data AS "eventData", activity.task_id AS "taskId",
            task.title AS "taskTitle", task.number AS "taskNumber",
            project.id AS "projectId", project.name AS "projectName",
            project.slug AS "projectSlug",
            project.workspace_id AS "workspaceId",
            workspace.name AS "workspaceName", activity.user_id AS "userId",
            "user".name AS "userName", activity.created_at AS "createdAt",
            ${relevance} AS "relevanceScore"
     FROM activity
     LEFT JOIN task ON activity.task_id = task.id
     LEFT JOIN project ON task.project_id = project.id
     LEFT JOIN workspace ON project.workspace_id = workspace.id
     LEFT JOIN "user" ON activity.user_id = "user".id
     WHERE ${filter} ${project}
       AND (${SEARCHABLE_TEXT} ILIKE ${textMatch} OR task.title ILIKE ${titleMatch})
       ${commentsOnly ? "AND activity.type = 'comment'" : ""}
     ORDER BY ${relevance} DESC, activity.created_at DESC
     LIMIT ${limit}`,
    parameters.values,
  )) as ActivityRow[];

  return activities.map((activity) => {
    const isComment = activity.type === "comment";
    return {
      id: activity.id,
      type: isComment ? "comment" : "activity",
      title: isComment
        ? `Comment on ${activity.taskTitle || "task"}`
        : `${activity.type} on ${activity.taskTitle || "task"}`,
      content: getActivitySearchContent(
        activity.type,
        activity.content,
        activity.eventData,
      ),
      projectId: activity.projectId || undefined,
      projectName: activity.projectName || undefined,
      projectSlug: activity.projectSlug || undefined,
      workspaceId: activity.workspaceId || undefined,
      workspaceName: activity.workspaceName || undefined,
      userId: activity.userId || undefined,
      userName: activity.userName || undefined,
      createdAt: activity.createdAt,
      relevanceScore: activity.relevanceScore,
      taskNumber: activity.taskNumber || undefined,
    };
  });
}
