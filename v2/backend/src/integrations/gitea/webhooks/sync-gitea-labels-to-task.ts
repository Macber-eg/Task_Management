import { In, type EntityManager } from "typeorm";
import { insertReturning, updateReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import { isSystemLabelName } from "./system-labels";

export type GiteaLabelInput = { name: string; color?: string };

export function normalizedGiteaLabelColor(label: { color?: string }): string {
  return label.color ? `#${label.color.replace(/^#/, "")}` : "#6B7280";
}

/** Non-system labels of a Gitea issue (for `label_updated`). */
export function giteaLabelsForSync(
  labels: Array<string | { name?: string; color?: string }> | undefined,
): GiteaLabelInput[] {
  if (!labels) return [];
  const out: GiteaLabelInput[] = [];
  for (const raw of labels) {
    const name = typeof raw === "string" ? raw : raw.name;
    if (!name || isSystemLabelName(name)) continue;
    const color = typeof raw === "object" && raw ? raw.color : undefined;
    out.push({ name, color });
  }
  return out;
}

/**
 * Makes the task's labels match the issue's. With `previousNames` (the last
 * synced issue labels) only labels that changed on the issue are added or
 * removed, so Kaneo-only labels survive.
 */
export async function syncGiteaLabelsToTask(
  tx: EntityManager,
  taskId: string,
  workspaceId: string,
  giteaLabels: GiteaLabelInput[],
  previousNames?: string[],
): Promise<void> {
  const desiredNames = new Set(giteaLabels.map((l) => l.name));
  const previous = previousNames ? new Set(previousNames) : undefined;
  const existingRows = await tx.find(LabelEntity, { where: { taskId } });

  const labelsToInsert = giteaLabels
    .filter(
      (g) =>
        (!previous || !previous.has(g.name)) &&
        !existingRows.some((row) => row.name === g.name),
    )
    .map((g) => ({
      name: g.name,
      color: normalizedGiteaLabelColor(g),
      taskId,
      workspaceId,
    }));

  const colorToIds = new Map<string, string[]>();
  for (const g of giteaLabels) {
    if (isSystemLabelName(g.name)) continue;
    const row = existingRows.find((r) => r.name === g.name);
    if (!row) continue;
    const want = normalizedGiteaLabelColor(g);
    const have = row.color ? `#${row.color.replace(/^#/, "")}` : "#6B7280";
    if (have === want) continue;
    const list = colorToIds.get(want) ?? [];
    list.push(row.id);
    colorToIds.set(want, list);
  }

  for (const [color, ids] of colorToIds) {
    if (ids.length === 0) continue;
    await updateReturning(tx, LabelEntity, { color }, { id: In(ids) });
  }

  for (const label of labelsToInsert) {
    await insertReturning(tx, LabelEntity, label, {
      onConflict: { target: ["taskId", "name"] },
    });
  }

  const labelsToDelete = existingRows
    .filter(
      (row) =>
        (!previous || previous.has(row.name)) &&
        !desiredNames.has(row.name) &&
        !isSystemLabelName(row.name),
    )
    .map((row) => row.id);

  if (labelsToDelete.length > 0) {
    await tx.delete(LabelEntity, { id: In(labelsToDelete) });
  }
}
