import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { EventBus } from "../../../events/event-bus";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import { getSubtaskParentProjects } from "../../shared/subtask-parent-projects";
import {
  assertValidTaskStatus,
  findStatusColumnId,
} from "../../shared/task-status";
import { type BulkContext, changedProjectsError } from "./bulk-task";

type Updated = {
  id: string;
  projectId: string;
  status: string;
  title: string;
  userId: string | null;
};

@Injectable()
export class BulkStatusOperation {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly effects: TaskMutationEffects,
  ) {}

  async run({ tasks, foundIds, value, userId }: BulkContext): Promise<number> {
    if (!value) {
      throw new HTTPException(400, { message: "Status value is required" });
    }
    const projectIds = [...new Set(tasks.map((t) => t.projectId))];

    // Validate every project's destination before the first write.
    const destinations = new Map<string, string | null>();
    for (const projectId of projectIds) {
      await assertValidTaskStatus(this.dataSource.manager, value, projectId);
      destinations.set(
        projectId,
        await findStatusColumnId(this.dataSource.manager, projectId, value),
      );
    }
    const { updatedTasks, beforeById } = await this.dataSource.transaction(
      async (tx) => {
        const before = (await tx.query(
          `SELECT id, status FROM task WHERE id = ANY($1::text[])
           ORDER BY id ASC FOR UPDATE`,
          [foundIds],
        )) as { id: string; status: string }[];
        const beforeById = new Map(before.map((task) => [task.id, task]));
        const result: Updated[] = [];
        for (const projectId of projectIds) {
          const projectTaskIds = tasks
            .filter((task) => task.projectId === projectId)
            .map((task) => task.id);
          const [changed] = (await tx.query(
            `UPDATE task SET status = $1, column_id = $2, updated_at = $3
             WHERE id = ANY($4::text[]) AND project_id = $5
             RETURNING id, project_id AS "projectId", status, title,
               assignee_id AS "userId"`,
            [
              value,
              destinations.get(projectId) ?? null,
              new Date(),
              projectTaskIds,
              projectId,
            ],
          )) as [Updated[], number];
          if (changed.length !== projectTaskIds.length)
            throw changedProjectsError();
          result.push(...changed);
        }
        return { updatedTasks: result, beforeById };
      },
    );
    const parentProjects = await getSubtaskParentProjects(
      this.dataSource.manager,
      foundIds,
    );
    await this.events.publish("subtask-parents.refresh", {
      projects: parentProjects,
    });
    for (const updatedTask of updatedTasks) {
      const before = beforeById.get(updatedTask.id);
      if (!before) continue;
      await this.effects.publishTaskMutation(before, updatedTask, userId, {
        fields: ["status"],
        skipRelationRefresh: true,
        skipSubtaskParentRefresh: true,
      });
      if (before.status === updatedTask.status)
        await this.events.publish("task.updated", {
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          userId,
        });
    }
    for (const projectId of projectIds)
      await this.events.publish("task-relation.refresh", { projectId, userId });
    return updatedTasks.length;
  }
}
