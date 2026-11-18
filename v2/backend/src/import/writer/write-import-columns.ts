import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { ColumnEntity } from "../../database/entities/column.entity";
import { chunk } from "./chunk";
import { insertRows } from "./insert-rows";
import type { ImportColumnPlan } from "./plan-import-columns";
import type { BoardColumn } from "./plan-import-tasks";

export type ImportBoard = {
  byKey: Map<string, BoardColumn>;
  fallback: BoardColumn | null;
  count: number;
};

export async function writeImportColumns(
  tx: EntityManager,
  projectId: string,
  plan: ImportColumnPlan,
): Promise<ImportBoard> {
  if (plan.columns.length === 0) {
    const defaults = await tx.find(ColumnEntity, {
      select: { id: true, slug: true },
      where: { projectId },
      order: { position: "ASC" },
    });
    const [first] = defaults;
    return {
      byKey: new Map(),
      fallback: first ? { id: first.id, slug: first.slug } : null,
      count: defaults.length,
    };
  }

  await tx.delete(ColumnEntity, { projectId });

  const planned = plan.columns.map((column) => ({
    key: column.key,
    row: {
      id: createId(),
      projectId,
      name: column.name,
      slug: column.slug,
      position: column.position,
      isFinal: column.isFinal,
    },
  }));
  for (const batch of chunk(planned.map(({ row }) => row))) {
    await insertRows(tx, ColumnEntity, batch);
  }

  const byKey = new Map(
    planned.map(({ key, row }) => [key, { id: row.id, slug: row.slug }]),
  );
  const first = planned[0]?.row;
  return {
    byKey,
    fallback: first ? { id: first.id, slug: first.slug } : null,
    count: planned.length,
  };
}
