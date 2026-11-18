import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { TaskMutationEffects } from "../effects/task-mutation-effects.service";
import { assertTaskPosition } from "../shared/task-position";
import {
  assertValidTaskStatus,
  findStatusColumnId,
} from "../shared/task-status";

type Reorder = { id: string; position: number; status?: string };
type ExpectedTask = { id: string; position: number | null; status: string };
type Before = { id: string; status: string; position: number | null };
type After = {
  id: string;
  position: number | null;
  status: string;
  projectId: string;
  title: string;
  userId: string | null;
};

/** Atomically sets card positions, and optionally columns, in one project. */
@Injectable()
export class TaskReorderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly effects: TaskMutationEffects,
  ) {}

  async reorderTasks(
    projectId: string,
    tasks: Reorder[],
    userId: string,
    expectedTasks?: ExpectedTask[],
  ) {
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
      throw new HTTPException(400, { message: "Task IDs must be unique" });
    for (const task of tasks) assertTaskPosition(task.position);
    const statuses = [
      ...new Set(
        tasks.flatMap((task) =>
          task.status === undefined ? [] : [task.status],
        ),
      ),
    ];
    const columns = new Map<string, string | null>();
    const manager = this.dataSource.manager;
    for (const status of statuses) {
      await assertValidTaskStatus(manager, status, projectId);
      columns.set(status, await findStatusColumnId(manager, projectId, status));
    }

    const { before, after } = await this.dataSource.transaction((tx) =>
      this.reorderInTransaction(
        tx,
        projectId,
        tasks,
        statuses,
        columns,
        expectedTasks,
      ),
    );

    const beforeById = new Map(before.map((task) => [task.id, task]));
    let statusChanged = false;
    for (const updated of after) {
      const prior = beforeById.get(updated.id);
      if (!prior) continue;
      if (prior.status !== updated.status) statusChanged = true;
      await this.effects.publishTaskMutation(prior, updated, userId, {
        fields: ["status"],
        skipRelationRefresh: true,
      });
    }
    if (statusChanged)
      await this.events.publish("task-relation.refresh", {
        projectId,
        userId,
      });
    await this.events.publish("tasks.reordered", {
      projectId,
      userId,
      tasks: after.map(({ id, position, status }) => ({
        id,
        position,
        status,
      })),
    });
    return after.map(({ id, position, status }) => ({
      id,
      position: position ?? 0,
      status,
    }));
  }

  private async reorderInTransaction(
    tx: EntityManager,
    projectId: string,
    tasks: Reorder[],
    statuses: string[],
    columns: Map<string, string | null>,
    expectedTasks?: ExpectedTask[],
  ) {
    // Task creation, duplication and moves lock this same row while
    // allocating positions.
    const [project] = (await tx.query(
      `SELECT id FROM project WHERE id = $1 FOR UPDATE`,
      [projectId],
    )) as { id: string }[];
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });

    // Lock all affected cards together; a concurrent move cannot escape the
    // scope check between reading their current state and writing positions.
    const before = (await tx.query(
      `SELECT id, status, position FROM task
       WHERE project_id = $1 AND ${expectedTasks ? "status" : "id"} = ANY($2::text[])
       ORDER BY id ASC FOR UPDATE`,
      [
        projectId,
        expectedTasks
          ? [
              ...new Set([
                ...expectedTasks.map((task) => task.status),
                ...statuses,
              ]),
            ]
          : tasks.map((task) => task.id),
      ],
    )) as Before[];

    if (expectedTasks) {
      const expected = new Map(expectedTasks.map((task) => [task.id, task]));
      if (
        expected.size !== expectedTasks.length ||
        before.length !== expectedTasks.length ||
        before.some((task) => {
          const old = expected.get(task.id);
          return (
            !old || old.status !== task.status || old.position !== task.position
          );
        })
      )
        throw new HTTPException(409, {
          message: "Board changed; refresh before reordering",
        });
    }
    const requestedIds = new Set(tasks.map((task) => task.id));
    if (
      before.filter((task) => requestedIds.has(task.id)).length !== tasks.length
    )
      throw new HTTPException(404, {
        message: "Tasks must belong to the requested project",
      });

    const values = tasks.map((task) => ({
      id: task.id,
      position: task.position,
      status: task.status ?? null,
      column_id:
        task.status === undefined ? null : (columns.get(task.status) ?? null),
    }));
    // One JSON parameter keeps large boards below PostgreSQL's bind limit.
    const [after] = (await tx.query(
      `UPDATE task SET
         position = changes.position,
         status = coalesce(changes.status, task.status),
         column_id = case when changes.status is null then task.column_id else changes.column_id end,
         updated_at = $3
       FROM jsonb_to_recordset($2::jsonb)
         AS changes(id text, position integer, status text, column_id text)
       WHERE task.project_id = $1 AND task.id = changes.id
       RETURNING task.id, task.position, task.status,
         task.project_id AS "projectId", task.title, task.assignee_id AS "userId"`,
      [projectId, JSON.stringify(values), new Date()],
    )) as [After[], number];
    if (after.length !== tasks.length)
      throw new HTTPException(409, {
        message: "Task changed projects; retry the move",
      });
    return { before, after };
  }
}
