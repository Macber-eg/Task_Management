import type { EntityManager } from "typeorm";
import { WorkspaceEntity } from "../../database/entities/workspace.entity";

export function findWorkspaceById(manager: EntityManager, id: string) {
  return manager.findOne(WorkspaceEntity, { where: { id } });
}

export function findWorkspaceBySlug(manager: EntityManager, slug: string) {
  return manager.findOne(WorkspaceEntity, { where: { slug } });
}
