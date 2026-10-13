import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectPhaseTable } from "../../database/schema";
import { assertPhasesEnabled } from "../assert-planning";
import { parsePlanningDate } from "../parse-planning-date";
import { assertValidPhaseParent, nextPhasePosition } from "../phase-parent";

async function createPhase({
  projectId,
  name,
  parentId,
  kind,
  startDate,
  endDate,
}: {
  projectId: string;
  name: string;
  parentId?: string | null;
  kind?: "folder" | "document";
  startDate?: string | null;
  endDate?: string | null;
}) {
  await assertPhasesEnabled(projectId);

  const trimmed = name.trim();
  if (!trimmed) {
    throw new HTTPException(400, { message: "Phase name is required" });
  }

  const resolvedParentId =
    parentId === undefined || parentId === "" ? null : parentId;
  await assertValidPhaseParent({
    projectId,
    parentId: resolvedParentId,
  });

  const resolvedKind = kind ?? "folder";
  if (resolvedKind === "document" && resolvedParentId === null) {
    throw new HTTPException(400, {
      message: "Documents must live inside a folder",
    });
  }

  const position = await nextPhasePosition(projectId, resolvedParentId);

  const [phase] = await db
    .insert(projectPhaseTable)
    .values({
      projectId,
      name: trimmed,
      parentId: resolvedParentId,
      kind: resolvedKind,
      position,
      startDate: parsePlanningDate(startDate, "startDate"),
      endDate: parsePlanningDate(endDate, "endDate"),
    })
    .returning();

  if (!phase) {
    throw new HTTPException(500, { message: "Failed to create phase" });
  }

  return phase;
}

export default createPhase;
