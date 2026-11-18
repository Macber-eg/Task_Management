import { type EntityManager, In } from "typeorm";
import { insertReturning, updateReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import { isSystemLabelName } from "../sync/system-labels";
import { type GitlabWebhookLabel, labelColor } from "../webhook/payload";

export function nonSystemLabels(
  labels: GitlabWebhookLabel[] | undefined,
): Array<{ name: string; color: string }> {
  const out: Array<{ name: string; color: string }> = [];
  for (const label of labels ?? []) {
    if (!label.title || isSystemLabelName(label.title)) continue;
    out.push({ name: label.title, color: labelColor(label) });
  }
  return out;
}

/**
 * Brings the task's own labels in line with a GitLab label change: adds new
 * names, follows colour changes and removes only names this event (or the
 * resume baseline) shows were removed.
 */
export async function syncGitlabLabelsToTask(
  db: EntityManager,
  taskId: string,
  workspaceId: string,
  gitlabLabels: Array<{ name: string; color: string }>,
  previousLabels: GitlabWebhookLabel[] | undefined,
  resumeBaseline?: string[],
) {
  const desiredNames = new Set(gitlabLabels.map((l) => l.name));
  const existingRows = await db.find(LabelEntity, { where: { taskId } });

  const labelsToInsert = gitlabLabels.filter(
    (g) =>
      (!resumeBaseline || !resumeBaseline.includes(g.name)) &&
      !existingRows.some((row) => row.name === g.name),
  );

  const colorToIds = new Map<string, string[]>();
  for (const g of gitlabLabels) {
    const row = existingRows.find((r) => r.name === g.name);
    if (!row) continue;
    const have = row.color ? `#${row.color.replace(/^#/, "")}` : "#6B7280";
    if (have === g.color) continue;
    const list = colorToIds.get(g.color) ?? [];
    list.push(row.id);
    colorToIds.set(g.color, list);
  }

  for (const [color, ids] of colorToIds) {
    await updateReturning(db, LabelEntity, { color }, { id: In(ids) });
  }

  for (const label of labelsToInsert) {
    await insertReturning(
      db,
      LabelEntity,
      { name: label.name, color: label.color, taskId, workspaceId },
      { onConflict: { target: ["taskId", "name"] } },
    );
  }

  // Absence from GitLab alone does not imply removal: local labels may not
  // have synced yet. Only delete names explicitly removed by this event.
  const previousNames = new Set(
    resumeBaseline ??
      nonSystemLabels(previousLabels).map((label) => label.name),
  );
  const labelsToDelete = existingRows
    .filter(
      (row) =>
        !isSystemLabelName(row.name) &&
        previousNames.has(row.name) &&
        !desiredNames.has(row.name),
    )
    .map((row) => row.id);

  if (labelsToDelete.length > 0) {
    await db.delete(LabelEntity, { id: In(labelsToDelete) });
  }
}
