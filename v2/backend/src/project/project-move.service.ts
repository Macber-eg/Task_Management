import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { createActivities } from "../activity/create-activities";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { ProjectEntity } from "../database/entities/project.entity";
import { EventBus } from "../events/event-bus";
import { RealtimeConnections } from "../realtime/realtime-connections";
import { filterUsersWithProjectAccess } from "./filter-users-with-project-access";
import { grantProjectToRestrictedMember } from "./grant-project-to-restricted-member";
import { findProjectKeyConflict } from "./project-key";
import { lockProjectOrdering } from "./project-placement";

type ProjectTask = { id: string; userId: string | null };

@Injectable()
export class ProjectMoveService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly realtime: RealtimeConnections,
  ) {}

  async moveProject(
    id: string,
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    currentUserId: string,
  ) {
    if (sourceWorkspaceId === targetWorkspaceId) {
      throw new HTTPException(400, {
        message: "Project already belongs to this workspace",
      });
    }

    const { movedProject, unassignedTasks } = await this.dataSource.transaction(
      async (tx) => {
        // A stable order for both workspaces before locking the project row.
        // This also keeps source reorders from updating a moved project.
        for (const workspaceId of [
          sourceWorkspaceId,
          targetWorkspaceId,
        ].sort()) {
          await lockProjectOrdering(tx, workspaceId);
        }
        // Locked for the transaction: the request was authorized against the
        // source workspace, so a concurrent move would invalidate that basis.
        const existingProject = await tx.findOne(ProjectEntity, {
          where: { id, workspaceId: sourceWorkspaceId },
          lock: { mode: "pessimistic_write" },
        });

        if (!existingProject) {
          throw new HTTPException(404, {
            message:
              "Project doesn't exist or doesn't belong to the specified workspace",
          });
        }

        // The key is the ticket-id prefix (KAN-12), resolved per workspace,
        // so a shared key would make ids ambiguous. Archived projects count.
        const keyConflict = await findProjectKeyConflict(
          tx,
          targetWorkspaceId,
          existingProject.slug,
          { excludeProjectId: id },
        );

        if (keyConflict) {
          throw new HTTPException(409, {
            message: `The target workspace already has a project using the key "${existingProject.slug}" (${keyConflict.name}). Change this project's key before moving it.`,
          });
        }

        const linked = (await tx.query(
          `SELECT 1 FROM task_relation relation
           JOIN task source ON source.id = relation.source_task_id
           JOIN task target ON target.id = relation.target_task_id
           WHERE (source.project_id = $1 AND target.project_id <> $1)
              OR (target.project_id = $1 AND source.project_id <> $1)
           LIMIT 1`,
          [id],
        )) as unknown[];
        if (linked.length)
          throw new HTTPException(409, {
            message:
              "Remove task relationships to other projects before moving this project.",
          });

        // These rows reference both the project and a notification rule
        // through composite keys carrying workspace_id; the cascade from the
        // project would violate the rule side, which stays behind.
        await tx.query(
          `DELETE FROM user_notification_workspace_project
           WHERE project_id = $1 AND workspace_id = $2`,
          [id, sourceWorkspaceId],
        );

        await tx.query(
          "DELETE FROM workspace_member_project WHERE project_id = $1",
          [id],
        );

        const [{ maxPosition } = { maxPosition: null }] = (await tx.query(
          `SELECT max(position) AS "maxPosition" FROM project
           WHERE workspace_id = $1`,
          [targetWorkspaceId],
        )) as { maxPosition: number | null }[];
        const appendedPosition = maxPosition === null ? 0 : maxPosition + 1;

        const [movedProject] = await updateReturning(
          tx,
          ProjectEntity,
          { workspaceId: targetWorkspaceId, position: appendedPosition },
          { id, workspaceId: sourceWorkspaceId },
        );

        if (!movedProject) {
          throw new HTTPException(409, {
            message: "Project was moved to another workspace, please try again",
          });
        }

        await grantProjectToRestrictedMember(tx, {
          workspaceId: targetWorkspaceId,
          userId: currentUserId,
          projectId: id,
        });

        const unassigned = await this.unassignNonMembers(
          tx,
          id,
          targetWorkspaceId,
        );

        // Older task moves could leave links owned by a different project.
        await tx.query(
          `DELETE FROM external_link
           WHERE task_id IN (SELECT id FROM task WHERE project_id = $1)
             AND integration_id IS NOT NULL
             AND integration_id NOT IN (
               SELECT id FROM integration WHERE project_id = $1
             )`,
          [id],
        );

        // Assets and task labels denormalize the project's workspace.
        await tx.query(
          "UPDATE asset SET workspace_id = $1 WHERE project_id = $2",
          [targetWorkspaceId, id],
        );

        // A subquery rather than an id list: this scales with the task count.
        await tx.query(
          `UPDATE label SET workspace_id = $1, updated_at = $3
           WHERE task_id IN (SELECT id FROM task WHERE project_id = $2)`,
          [targetWorkspaceId, id, new Date()],
        );

        // History stays atomic with the move; inserts are chunked.
        await createActivities(
          tx,
          unassigned.map((task) => ({
            taskId: task.id,
            type: "unassigned",
            userId: currentUserId,
            content: null,
            eventData: {},
          })),
        );

        return { movedProject, unassignedTasks: unassigned };
      },
    );

    await this.realtime.closeProjectConnections(id);

    await this.events.publish("integration.sync_labels_changed", {
      projectId: id,
    });
    await this.events.publish("project.updated", { projectId: id });

    if (unassignedTasks.length > 0) {
      await this.events.publish("task.bulk_unassigned", {
        projectId: id,
        userId: currentUserId,
      });
    }

    return { ...movedProject, unassignedTaskCount: unassignedTasks.length };
  }

  /** Clears assignees who cannot see the project in its new workspace. */
  private async unassignNonMembers(
    tx: EntityManager,
    projectId: string,
    targetWorkspaceId: string,
  ): Promise<ProjectTask[]> {
    const tasks = (await tx.query(
      `SELECT id, assignee_id AS "userId" FROM task WHERE project_id = $1`,
      [projectId],
    )) as ProjectTask[];

    const assigneeIds = [
      ...new Set(
        tasks
          .map((task) => task.userId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];
    if (assigneeIds.length === 0) return [];

    const targetMembers = (await tx.query(
      `SELECT user_id AS "userId" FROM workspace_member
       WHERE workspace_id = $1 AND user_id = ANY($2::text[])`,
      [targetWorkspaceId, assigneeIds],
    )) as { userId: string }[];

    const memberIds = await filterUsersWithProjectAccess(
      tx,
      targetMembers.map((member) => member.userId),
      projectId,
    );
    // Rows rather than a count: each needs an activity row afterwards.
    const unassigned = tasks.filter(
      (task) => task.userId && !memberIds.has(task.userId),
    );

    if (unassigned.length > 0) {
      // Predicated on the assignees rather than the task ids: the member set
      // is bounded by workspace size, the task list is not.
      await tx.query(
        `UPDATE task SET assignee_id = NULL, updated_at = $2
         WHERE project_id = $1 AND assignee_id IS NOT NULL
           ${memberIds.size > 0 ? "AND assignee_id <> ALL($3::text[])" : ""}`,
        memberIds.size > 0
          ? [projectId, new Date(), [...memberIds]]
          : [projectId, new Date()],
      );
    }

    return unassigned;
  }
}
