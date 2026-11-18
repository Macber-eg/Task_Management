import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { TaskMutationEffects } from "../../effects/task-mutation-effects.service";
import { assertAssignableUser } from "../../shared/assignable-users";
import { assertValidPriority } from "../../shared/task-priority";
import { type BulkContext, lockUnmovedTasks } from "./bulk-task";

type Locked = {
  id: string;
  projectId: string;
  title: string;
  userId: string | null;
};

/** Bulk priority, assignee and due date: one value written to every task. */
@Injectable()
export class BulkFieldOperations {
  constructor(
    private readonly dataSource: DataSource,
    private readonly effects: TaskMutationEffects,
  ) {}

  async updatePriority(context: BulkContext): Promise<number> {
    const value = context.value;
    if (!value) {
      throw new HTTPException(400, { message: "Priority value is required" });
    }
    assertValidPriority(value);

    const before = await this.dataSource.transaction(async (tx) => {
      const locked = await lockUnmovedTasks<Locked & { priority: string }>(
        tx,
        context,
        `id, project_id AS "projectId", title, assignee_id AS "userId", priority`,
      );
      await tx.query(
        `UPDATE task SET priority = $1, updated_at = $2 WHERE id = ANY($3::text[])`,
        [value, new Date(), context.foundIds],
      );
      return locked;
    });
    for (const task of before)
      await this.effects.publishTaskMutation(
        task,
        { ...task, priority: value },
        context.userId,
        { fields: ["priority"] },
      );
    return before.length;
  }

  async updateAssignee(context: BulkContext): Promise<number> {
    const assigneeId = context.value?.trim() || null;
    const manager = this.dataSource.manager;

    if (assigneeId) {
      await assertAssignableUser(
        manager,
        assigneeId,
        context.workspaceId,
        context.tasks.map((task) => task.projectId),
      );
    }

    const [assignee] = assigneeId
      ? ((await manager.query(`SELECT name FROM "user" WHERE id = $1 LIMIT 1`, [
          assigneeId,
        ])) as { name: string }[])
      : [];
    const before = await this.dataSource.transaction(async (tx) => {
      const locked = await lockUnmovedTasks<Locked>(
        tx,
        context,
        `id, project_id AS "projectId", title, assignee_id AS "userId"`,
      );
      await tx.query(
        `UPDATE task SET assignee_id = $1, updated_at = $2 WHERE id = ANY($3::text[])`,
        [assigneeId, new Date(), context.foundIds],
      );
      return locked;
    });
    for (const task of before)
      await this.effects.publishTaskMutation(
        task,
        { ...task, userId: assigneeId },
        context.userId,
        { fields: ["userId"], assigneeName: assignee?.name ?? null },
      );
    return before.length;
  }

  async updateDueDate(context: BulkContext): Promise<number> {
    const { value } = context;
    let parsedDate: Date | null = null;
    if (value) {
      parsedDate = new Date(value);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new HTTPException(400, {
          message: `Invalid date value "${value}"`,
        });
      }
    }

    const { updatedTasks, beforeById } = await this.dataSource.transaction(
      async (tx) => {
        const before = await lockUnmovedTasks<{
          id: string;
          projectId: string;
          dueDate: Date | null;
        }>(tx, context, `id, project_id AS "projectId", due_date AS "dueDate"`);
        const beforeById = new Map(before.map((task) => [task.id, task]));
        const changedIds = before
          .filter((task) => task.dueDate?.getTime() !== parsedDate?.getTime())
          .map((task) => task.id);
        if (changedIds.length)
          await tx.query(
            `DELETE FROM task_reminder_sent WHERE task_id = ANY($1::text[])`,
            [changedIds],
          );
        const [updatedTasks] = (await tx.query(
          `UPDATE task SET due_date = $1, updated_at = $2
           WHERE id = ANY($3::text[])
           RETURNING id, project_id AS "projectId", title, due_date AS "dueDate"`,
          [parsedDate, new Date(), context.foundIds],
        )) as [
          {
            id: string;
            projectId: string;
            title: string;
            dueDate: Date | null;
          }[],
          number,
        ];
        return { updatedTasks, beforeById };
      },
    );
    for (const updatedTask of updatedTasks) {
      const before = beforeById.get(updatedTask.id);
      if (!before) continue;
      await this.effects.publishTaskMutation(
        before,
        updatedTask,
        context.userId,
        {
          fields: ["dueDate"],
        },
      );
    }
    return updatedTasks.length;
  }
}
