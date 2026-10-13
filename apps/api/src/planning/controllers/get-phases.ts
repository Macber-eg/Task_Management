import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { projectPhaseTable } from "../../database/schema";

async function getPhases(projectId: string, includeArchived = false) {
  return db
    .select()
    .from(projectPhaseTable)
    .where(
      includeArchived
        ? eq(projectPhaseTable.projectId, projectId)
        : and(
            eq(projectPhaseTable.projectId, projectId),
            isNull(projectPhaseTable.archivedAt),
          ),
    )
    .orderBy(
      asc(projectPhaseTable.parentId),
      asc(projectPhaseTable.position),
      asc(projectPhaseTable.id),
    );
}

export default getPhases;
