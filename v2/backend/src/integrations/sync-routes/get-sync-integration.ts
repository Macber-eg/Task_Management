import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import type { ProjectEntity } from "../../database/entities/project.entity";
import { readSyncRules } from "../sync/rules";

export type SyncBinding = IntegrationEntity & { project: ProjectEntity };

/** The project's integration of this provider, with valid sync rules. */
export async function getSyncIntegration(
  db: EntityManager,
  projectId: string,
  provider: string,
): Promise<SyncBinding> {
  const integration = await db.findOne(IntegrationEntity, {
    where: { projectId, type: provider },
    relations: { project: true },
  });
  if (!integration?.project)
    throw new HTTPException(404, { message: "Integration not found" });
  if (!readSyncRules(integration.config))
    throw new HTTPException(409, {
      message: "Invalid sync rules; repair the integration configuration",
    });
  return integration as SyncBinding;
}
