import type { EntityManager } from "typeorm";
import { updateReturning } from "../../database/dml";
import { ImportRunEntity } from "../../database/entities/import-run.entity";

export type RunChanges = Partial<
  Pick<
    ImportRunEntity,
    "status" | "message" | "projects" | "error" | "finishedAt"
  >
>;

/** Writes progress to a run that is still running; false once it is not. */
export async function updateRunningRun(
  manager: EntityManager,
  runId: string,
  changes: RunChanges,
): Promise<boolean> {
  const updated = await updateReturning(
    manager,
    ImportRunEntity,
    { ...changes, heartbeatAt: new Date() },
    { id: runId, status: "running" },
  );
  return updated.length > 0;
}
