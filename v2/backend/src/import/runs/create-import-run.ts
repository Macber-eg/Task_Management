import type { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { ImportRunEntity } from "../../database/entities/import-run.entity";
import type { ImportSourceId } from "../../importers";
import type { ImportRunProject } from "../import-run-project";
import { assertNoRunningImport } from "./assert-no-running-import";

export async function createImportRun(
  dataSource: DataSource,
  {
    workspaceId,
    userId,
    source,
    includeComments,
    projects,
  }: {
    workspaceId: string;
    userId: string;
    source: ImportSourceId;
    includeComments: boolean;
    projects: ImportRunProject[];
  },
): Promise<ImportRunEntity> {
  return dataSource.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('import-run'), hashtext($1))",
      [workspaceId],
    );
    await assertNoRunningImport(tx, workspaceId);

    const run = await insertReturning(tx, ImportRunEntity, {
      workspaceId,
      userId,
      source,
      includeComments,
      projects,
      message: "Starting the import",
    });
    if (!run) throw new Error("Failed to create the import run");
    return run;
  });
}
