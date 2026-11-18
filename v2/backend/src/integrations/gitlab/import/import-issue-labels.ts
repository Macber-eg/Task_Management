import { type EntityManager, In } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import { isSystemLabelName } from "../sync/system-labels";

/**
 * Adds an imported issue's labels to the task (workspace colour when one
 * exists). Labels missing in GitLab are kept: absence there is no removal.
 */
export async function importLabelsForTask(
  db: EntityManager,
  issueLabels: string[],
  taskId: string,
  workspaceId: string,
): Promise<void> {
  const names = issueLabels.filter((name) => name && !isSystemLabelName(name));

  if (names.length === 0) {
    return;
  }

  const existingLabelsOnTask = await db.find(LabelEntity, {
    where: { taskId, name: In(names) },
  });

  for (const name of names) {
    if (existingLabelsOnTask.some((label) => label.name === name)) {
      continue;
    }

    const existingWorkspaceLabel = await db.findOne(LabelEntity, {
      where: { workspaceId, name },
    });

    await insertReturning(
      db,
      LabelEntity,
      {
        name,
        color: existingWorkspaceLabel?.color || "#6B7280",
        taskId,
        workspaceId,
      },
      { onConflict: { target: ["taskId", "name"] } },
    );
  }
}
