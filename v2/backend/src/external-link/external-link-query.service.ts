import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { parseLinkMetadata } from "./parse-link-metadata";

type LinkRow = {
  id: string;
  taskId: string;
  integrationId: string | null;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  joinedIntegrationId: string | null;
  integrationType: string | null;
};

/** A task's resource links, manual and integration-managed. */
@Injectable()
export class ExternalLinkQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async getExternalLinksByTask(taskId: string) {
    // Never widen the integration columns: integration.config holds plaintext
    // provider secrets and this route is reachable by any workspace member.
    const rows = (await this.dataSource.query(
      `SELECT l.id, l.task_id AS "taskId", l.integration_id AS "integrationId",
              l.resource_type AS "resourceType", l.external_id AS "externalId",
              l.url, l.title, l.metadata,
              l.created_at AS "createdAt", l.updated_at AS "updatedAt",
              i.id AS "joinedIntegrationId", i.type AS "integrationType"
       FROM external_link AS l
       LEFT JOIN integration AS i ON l.integration_id = i.id
       WHERE l.task_id = $1`,
      [taskId],
    )) as LinkRow[];

    return rows.map(({ joinedIntegrationId, integrationType, ...link }) => ({
      ...link,
      integration:
        joinedIntegrationId !== null && integrationType !== null
          ? { id: joinedIntegrationId, type: integrationType }
          : null,
      metadata: parseLinkMetadata(link.metadata),
    }));
  }
}
