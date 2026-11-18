import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { pauseIssueLinks } from "../sync/pause-issue-links";
import { readSyncRules, type SyncRules } from "../sync/rules";
import { sql } from "../sync/sql-fragment";
import { outgoingPredicate } from "../sync/task-predicate";
import { getAuthorizedSyncProject } from "./get-authorized-sync-project";
import { getSyncIntegration } from "./get-sync-integration";
import { previewSyncRules } from "./preview-sync-rules";

/** Reading, previewing and saving an integration's sync rules. */
@Injectable()
export class SyncRulesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  getRules(
    projectId: string,
    provider: string,
    authorizedWorkspaceId: string,
    after?: string,
  ) {
    return this.dataSource.transaction(async (tx) => {
      await getAuthorizedSyncProject(tx, projectId, authorizedWorkspaceId, true);
      const integration = await getSyncIntegration(tx, projectId, provider);
      return previewSyncRules(
        tx,
        integration,
        readSyncRules(integration.config)!,
        after,
      );
    });
  }

  previewRules(
    projectId: string,
    provider: string,
    rules: SyncRules,
    authorizedWorkspaceId: string,
  ) {
    return this.dataSource.transaction(async (tx) => {
      await getAuthorizedSyncProject(tx, projectId, authorizedWorkspaceId, true);
      return previewSyncRules(
        tx,
        await getSyncIntegration(tx, projectId, provider),
        rules,
      );
    });
  }

  /**
   * Saves rules only if the preview behind `previewToken` is still current,
   * pausing links the old or new rule excludes, then reconciles.
   */
  async saveRules(
    projectId: string,
    provider: string,
    rules: SyncRules,
    previewToken: string,
    authorizedWorkspaceId: string,
  ) {
    const integration = await getSyncIntegration(
      this.dataSource.manager,
      projectId,
      provider,
    );
    const savedPreview = await this.dataSource.transaction(async (tx) => {
      // Keep the workspace authorized by middleware stable through the save.
      const project = await getAuthorizedSyncProject(
        tx,
        projectId,
        authorizedWorkspaceId,
        true,
      );
      const [current] = (await tx.query(
        `SELECT id, project_id AS "projectId", config, is_active AS "isActive"
         FROM integration WHERE id = $1 AND config = $2 FOR UPDATE`,
        [integration.id, integration.config],
      )) as {
        id: string;
        projectId: string;
        config: string;
        isActive: boolean | null;
      }[];
      if (!current)
        throw new HTTPException(409, {
          message: "Integration changed; preview again before saving",
        });
      const currentIntegration = { ...integration, ...current, project };
      const preview = await previewSyncRules(tx, currentIntegration, rules);
      if (preview.previewToken !== previewToken)
        throw new HTTPException(409, {
          message: "Sync impact changed; preview again before saving",
        });
      if (preview.missingLabels.length)
        throw new HTTPException(400, {
          message: "Select existing labels from this workspace",
        });
      const oldScope = await outgoingPredicate(
        tx,
        project.workspaceId,
        readSyncRules(current.config)!.outgoing,
      );
      const nextScope = await outgoingPredicate(
        tx,
        project.workspaceId,
        rules.outgoing,
      );
      await pauseIssueLinks(
        tx,
        projectId,
        integration.id,
        sql`(not (${oldScope.predicate}) or not (${nextScope.predicate}))`,
      );
      const config = JSON.parse(current.config) as Record<string, unknown>;
      const nextConfig = JSON.stringify({ ...config, syncRules: rules });
      await tx.query(
        `UPDATE integration SET config = $1, updated_at = $2 WHERE id = $3`,
        [nextConfig, new Date(), integration.id],
      );
      // A post-commit project move must not expose the destination's labels.
      return previewSyncRules(
        tx,
        { ...currentIntegration, config: nextConfig },
        rules,
      );
    });
    await this.events.publish("integration.sync_rules_changed", {
      projectId,
      integrationId: integration.id,
    });
    await this.events.publish("project.updated", {
      projectId,
      linksChanged: true,
    });
    return savedPreview;
  }
}
