import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { EXTERNAL_LINK_SCOPE } from "./integration-task-scope";

/** Links whose task still belongs to the link's integration project. */
function scopedLinks(db: EntityManager) {
  return db
    .createQueryBuilder(ExternalLinkEntity, "link")
    .where(EXTERNAL_LINK_SCOPE);
}

export function findExternalLink(
  db: EntityManager,
  integrationId: string,
  resourceType: string,
  externalId: string,
): Promise<ExternalLinkEntity | null> {
  return scopedLinks(db)
    .andWhere("link.integration_id = :integrationId", { integrationId })
    .andWhere("link.resource_type = :resourceType", { resourceType })
    .andWhere("link.external_id = :externalId", { externalId })
    .getOne();
}

export function findExternalLinkByTaskAndType(
  db: EntityManager,
  taskId: string,
  integrationId: string,
  resourceType: string,
): Promise<ExternalLinkEntity | null> {
  return scopedLinks(db)
    .andWhere("link.task_id = :taskId", { taskId })
    .andWhere("link.integration_id = :integrationId", { integrationId })
    .andWhere("link.resource_type = :resourceType", { resourceType })
    .getOne();
}

/** With each link's integration loaded. */
export function findExternalLinksByTask(
  db: EntityManager,
  taskId: string,
): Promise<ExternalLinkEntity[]> {
  return scopedLinks(db)
    .leftJoinAndSelect("link.integration", "integration")
    .andWhere("link.task_id = :taskId", { taskId })
    .getMany();
}

export function getExternalLinksByIntegration(
  db: EntityManager,
  integrationId: string,
): Promise<ExternalLinkEntity[]> {
  return db.find(ExternalLinkEntity, { where: { integrationId } });
}
