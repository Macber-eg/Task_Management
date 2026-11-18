import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { getLabelsForIssue } from "../links/issue-format";
import { issueLabelNames } from "./rules";

const isFieldLabel = (name: string) =>
  name.startsWith("status:") || name.startsWith("priority:");

/** The labels an exported issue carries: priority/status plus the task's own. */
export async function taskIssueLabels(
  db: EntityManager,
  taskId: string,
  priority: string | null,
  status: string,
): Promise<string[]> {
  const assigned = (await db.query(`SELECT name FROM label WHERE task_id = $1`, [
    taskId,
  ])) as { name: string }[];
  return [
    ...new Set([
      ...getLabelsForIssue(priority, status),
      ...assigned.map((label) => label.name).filter((name) => !isFieldLabel(name)),
    ]),
  ];
}

/**
 * Copies an issue's labels (other than priority/status) onto the task, using
 * the workspace label's colour when one exists, else the provider's.
 */
export async function importIssueLabels(
  db: EntityManager,
  taskId: string,
  workspaceId: string,
  labels: unknown,
): Promise<void> {
  const names = issueLabelNames(labels).filter((name) => !isFieldLabel(name));
  if (!names.length) return;
  const providerColors = new Map<string, string>();
  if (Array.isArray(labels))
    for (const label of labels as unknown[]) {
      if (!label || typeof label !== "object") continue;
      const color = (label as { color?: unknown }).color;
      if (typeof color !== "string" || !color) continue;
      const [name] = issueLabelNames([label]);
      if (name) providerColors.set(name, `#${color.replace(/^#/, "")}`);
    }
  const existing = (await db.query(
    `SELECT name, color FROM label WHERE workspace_id = $1 AND task_id IS NULL`,
    [workspaceId],
  )) as { name: string; color: string }[];
  const rows = [...new Set(names)].map((name) => [
    createId(),
    name,
    existing.find((label) => label.name === name)?.color ??
      providerColors.get(name) ??
      "#6B7280",
  ]);
  const values: unknown[] = [taskId, workspaceId];
  const tuples = rows.map((row) => {
    values.push(...row);
    const base = values.length - 3;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $1, $2)`;
  });
  await db.query(
    `INSERT INTO label (id, name, color, task_id, workspace_id)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (task_id, name) DO NOTHING`,
    values,
  );
}
