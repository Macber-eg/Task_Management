import type { EntityManager } from "typeorm";
import { escapeLikePattern } from "./like-pattern";
import type { SearchResult, SearchScope } from "./search-result";
import { SqlParameters } from "./sql-parameters";
import { TASK_SHORT_ID_PATTERN } from "./task-short-id";
import { workspaceFilter } from "./workspace-filter";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
  taskNumber: number | null;
  priority: string;
  status: string;
  relevanceScore?: number;
};

const TASK_FIELDS = `task.id, task.title, task.description,
  task.project_id AS "projectId", project.name AS "projectName",
  project.slug AS "projectSlug", project.workspace_id AS "workspaceId",
  workspace.name AS "workspaceName", task.assignee_id AS "userId",
  "user".name AS "userName", task.created_at AS "createdAt",
  task.number AS "taskNumber", task.priority, task.status`;

const TASK_JOINS = `FROM task
  LEFT JOIN project ON task.project_id = project.id
  LEFT JOIN workspace ON project.workspace_id = workspace.id
  LEFT JOIN "user" ON task.assignee_id = "user".id`;

function toResult(task: TaskRow, relevanceScore: number): SearchResult {
  return {
    id: task.id,
    type: "task",
    title: task.title,
    description: task.description || undefined,
    projectId: task.projectId,
    projectName: task.projectName || undefined,
    projectSlug: task.projectSlug || undefined,
    workspaceId: task.workspaceId || undefined,
    workspaceName: task.workspaceName || undefined,
    userId: task.userId || undefined,
    userName: task.userName || undefined,
    createdAt: task.createdAt,
    relevanceScore,
    taskNumber: task.taskNumber || undefined,
    priority: task.priority || undefined,
    status: task.status,
  };
}

/** The task a short id such as "DEP-23" names, if the query is one. */
async function findByShortId(
  manager: EntityManager,
  query: string,
  scope: SearchScope,
): Promise<TaskRow[]> {
  // Project keys are stored NFKC-normalized, so the query is normalized too.
  const match = query.normalize("NFKC").match(TASK_SHORT_ID_PATTERN);
  const taskNumber = Number(match?.[2]);
  if (
    !match?.[1] ||
    !Number.isSafeInteger(taskNumber) ||
    taskNumber <= 0 ||
    taskNumber > 2_147_483_647
  )
    return [];

  const parameters = new SqlParameters();
  const filter = workspaceFilter(scope, parameters);
  const project = scope.projectId
    ? `AND task.project_id = ${parameters.add(scope.projectId)}`
    : "";
  // Escaped: a key may hold `_`, which ILIKE reads as "any one character",
  // so `DE_-23` would also match `DEP` and LIMIT 1 would pick either.
  const slug = parameters.add(escapeLikePattern(match[1]));
  const number = parameters.add(taskNumber);
  return manager.query(
    `SELECT ${TASK_FIELDS} ${TASK_JOINS}
     WHERE ${filter} ${project}
       AND project.slug ILIKE ${slug}
       AND task.number = ${number}
     LIMIT 1`,
    parameters.values,
  );
}

export async function searchTasks(
  manager: EntityManager,
  query: string,
  scope: SearchScope,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seenTaskIds = new Set<string>();

  for (const task of await findByShortId(manager, query, scope)) {
    seenTaskIds.add(task.id);
    // Highest relevance for an exact short-id match.
    results.push(toResult(task, 10));
  }

  const parameters = new SqlParameters();
  const filter = workspaceFilter(scope, parameters);
  const project = scope.projectId
    ? `AND task.project_id = ${parameters.add(scope.projectId)}`
    : "";
  const relevance = `CASE
      WHEN LOWER(task.title) LIKE ${parameters.add(scope.pattern)} THEN 3
      WHEN LOWER(task.description) LIKE ${parameters.add(scope.pattern)} THEN 2
      ELSE 1
    END`;
  const titleMatch = parameters.add(scope.pattern);
  const descriptionMatch = parameters.add(scope.pattern);
  const limit = parameters.add(scope.limit);
  const tasks = (await manager.query(
    `SELECT ${TASK_FIELDS}, ${relevance} AS "relevanceScore" ${TASK_JOINS}
     WHERE ${filter} ${project}
       AND (task.title ILIKE ${titleMatch}
         OR task.description ILIKE ${descriptionMatch})
     ORDER BY ${relevance} DESC, task.created_at DESC
     LIMIT ${limit}`,
    parameters.values,
  )) as TaskRow[];

  for (const task of tasks) {
    if (seenTaskIds.has(task.id)) continue;
    results.push(toResult(task, task.relevanceScore ?? 1));
  }
  return results;
}
