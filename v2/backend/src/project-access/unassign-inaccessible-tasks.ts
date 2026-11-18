import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { createActivities } from "../activity/create-activities";

type UnassignedTask = { id: string; projectId: string };

/** Takes the member off the workspace's tasks in projects they cannot see. */
export async function unassignInaccessibleTasks(
  manager: EntityManager,
  change: { workspaceId: string; userId: string; actorId: string },
): Promise<UnassignedTask[]> {
  // An UPDATE answers [rows, affected count].
  const [unassigned] = (await manager.query(
    `UPDATE task SET assignee_id = NULL, updated_at = $3
     WHERE assignee_id = $1
       AND project_id IN (
         SELECT p.id FROM project AS p
         WHERE p.workspace_id = $2
           AND NOT ${projectAccessCondition("$1", "p.id")}
       )
     RETURNING id, project_id AS "projectId"`,
    [change.userId, change.workspaceId, new Date()],
  )) as [UnassignedTask[], number];

  await createActivities(
    manager,
    unassigned.map((task) => ({
      taskId: task.id,
      type: "unassigned",
      userId: change.actorId,
      content: null,
      eventData: {},
    })),
  );

  return unassigned;
}
