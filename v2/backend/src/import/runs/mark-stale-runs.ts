import { type EntityManager, LessThan } from "typeorm";
import { ImportRunEntity } from "../../database/entities/import-run.entity";
import { logImportError } from "../log-import-error";
import {
  type ImportRunRow,
  interruptedRun,
  isStaleRun,
  STALE_RUN_MS,
} from "./to-import-run-response";

export async function markStaleRuns(
  manager: EntityManager,
  rows: readonly ImportRunRow[],
  now: Date,
) {
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  const stale = rows.filter((row) => isStaleRun(row, now));
  const results = await Promise.allSettled(
    stale.map((row) =>
      manager.update(
        ImportRunEntity,
        { id: row.id, status: "running", heartbeatAt: LessThan(cutoff) },
        interruptedRun(row),
      ),
    ),
  );
  results.forEach((result, index) => {
    const row = stale[index];
    if (result.status === "rejected" && row) {
      logImportError(
        "Failed to mark a stale import run",
        row.id,
        result.reason,
      );
    }
  });
}
