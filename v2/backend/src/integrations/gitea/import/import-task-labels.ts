import { In, Not, type EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import type { GiteaIssue } from "../client/gitea-types";

/**
 * Makes the task's labels exactly the issue's non-system labels, reusing the
 * colour of a workspace label with the same name.
 */
export async function importTaskLabels(
  tx: EntityManager,
  issueLabels: GiteaIssue["labels"],
  taskId: string,
  workspaceId: string,
): Promise<void> {
  const nonSystemLabels = (issueLabels ?? [])
    .map((label) =>
      typeof label === "string"
        ? { name: label as string, color: "#6B7280" }
        : {
            name: label.name,
            color: label.color
              ? `#${String(label.color).replace(/^#/, "")}`
              : "#6B7280",
          },
    )
    .filter(
      (label) =>
        label.name &&
        !label.name.startsWith("priority:") &&
        !label.name.startsWith("status:"),
    );

  const expectedNames = nonSystemLabels.map((label) => label.name);

  await tx.delete(
    LabelEntity,
    expectedNames.length > 0
      ? { taskId, name: Not(In(expectedNames)) }
      : { taskId },
  );

  const existingLabelsOnTask = await tx.find(LabelEntity, {
    where:
      expectedNames.length > 0
        ? { taskId, name: In(expectedNames) }
        : { taskId },
  });

  for (const labelData of nonSystemLabels) {
    if (existingLabelsOnTask.some((label) => label.name === labelData.name)) {
      continue;
    }

    const existingWorkspaceLabel = await tx.findOne(LabelEntity, {
      where: { workspaceId, name: labelData.name },
    });

    await insertReturning(
      tx,
      LabelEntity,
      {
        name: labelData.name,
        color: existingWorkspaceLabel?.color || labelData.color,
        taskId,
        workspaceId,
      },
      { onConflict: { target: ["taskId", "name"] } },
    );
  }
}
