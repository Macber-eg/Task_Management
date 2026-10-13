import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectPhaseTable } from "../../database/schema";

async function deletePhase(id: string) {
  const [phase] = await db
    .delete(projectPhaseTable)
    .where(eq(projectPhaseTable.id, id))
    .returning();

  if (!phase) {
    throw new HTTPException(404, { message: "Phase not found" });
  }

  return phase;
}

export default deletePhase;
