import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { projectSprintTable } from "../../database/schema";

async function getSprints(projectId: string) {
  return db
    .select()
    .from(projectSprintTable)
    .where(eq(projectSprintTable.projectId, projectId))
    .orderBy(asc(projectSprintTable.position), asc(projectSprintTable.id));
}

export default getSprints;
