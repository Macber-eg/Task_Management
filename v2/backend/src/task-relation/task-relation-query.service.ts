import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

type RelationRow = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  createdAt: Date;
};

type RelatedTask = {
  id: string;
  title: string;
  status: string;
  isCompleted: boolean;
  priority: string | null;
  number: number | null;
  projectId: string;
  userId: string | null;
  assigneeName: string | null;
};

/** A task's relations with summaries of the linked tasks. */
@Injectable()
export class TaskRelationQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async getTaskRelations(taskId: string, workspaceId: string, userId: string) {
    const manager = this.dataSource.manager;
    const relations = (await manager.query(
      `SELECT id, source_task_id AS "sourceTaskId",
              target_task_id AS "targetTaskId",
              relation_type AS "relationType", created_at AS "createdAt"
       FROM task_relation
       WHERE source_task_id = $1 OR target_task_id = $1`,
      [taskId],
    )) as RelationRow[];

    const taskIds = new Set<string>();
    for (const rel of relations) {
      taskIds.add(rel.sourceTaskId);
      taskIds.add(rel.targetTaskId);
    }

    const tasks = new Map<string, RelatedTask>();

    if (taskIds.size > 0) {
      // Completion belongs to the task's workflow, even when its parent is elsewhere.
      const taskRows = (await manager.query(
        `SELECT t.id, t.title, t.status,
                EXISTS (
                  SELECT 1 FROM "column" AS c
                  WHERE c.project_id = t.project_id
                    AND c.slug = t.status
                    AND c.is_final = true
                ) AS "isCompleted",
                t.priority, t.number, t.project_id AS "projectId",
                t.assignee_id AS "userId", u.name AS "assigneeName"
         FROM task AS t
         INNER JOIN project AS p ON t.project_id = p.id
         LEFT JOIN "user" AS u ON t.assignee_id = u.id
         WHERE t.id = ANY($1::text[])
           AND p.workspace_id = $2
           AND ${projectAccessCondition("$3", "p.id")}`,
        [[...taskIds], workspaceId, userId],
      )) as RelatedTask[];

      for (const task of taskRows) {
        tasks.set(task.id, task);
      }
    }

    return relations
      .filter(
        (rel) => tasks.has(rel.sourceTaskId) && tasks.has(rel.targetTaskId),
      )
      .map((rel) => ({
        ...rel,
        sourceTask: tasks.get(rel.sourceTaskId) ?? null,
        targetTask: tasks.get(rel.targetTaskId) ?? null,
      }));
  }
}
