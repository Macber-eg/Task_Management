import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { WorkspaceEntity } from "../../../src/database/entities/workspace.entity";
import { insertRow } from "./insert-row";

/** A workspace with no members and no stored roles. */
export function createWorkspace(
  db: EntityManager,
  values: Partial<Omit<WorkspaceEntity, "slug">> = {},
): Promise<WorkspaceEntity> {
  return insertRow(db, WorkspaceEntity, {
    id: `workspace-${randomUUID()}`,
    name: "Workspace",
    slug: `workspace-${randomUUID()}`,
    createdAt: new Date(),
    ...values,
  });
}
