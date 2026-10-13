import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectSprintTable } from "../../database/schema";

async function deleteSprint(id: string) {
  const [sprint] = await db
    .delete(projectSprintTable)
    .where(eq(projectSprintTable.id, id))
    .returning();

  if (!sprint) {
    throw new HTTPException(404, { message: "Sprint not found" });
  }

  return sprint;
}

export default deleteSprint;
