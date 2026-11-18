import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { EventBus } from "../../events/event-bus";
import { IntegrationPluginRegistry } from "../core/integration-plugin-registry";
import { findLinkedTask } from "../links/integration-task-scope";
import { canSyncTask } from "./eligibility";
import { reconciliationPredicate } from "./reconciliation-predicate";
import { readSyncRules } from "./rules";
import { runSql, sql } from "./sql-fragment";
import { getSyncIntegrations, type SyncIntegration } from "./sync-integrations";
import { outgoingPredicate } from "./task-predicate";

/**
 * Re-applies sync rules after label, rule or project changes: exports tasks
 * that newly match (through the provider plugin's `onTaskCreated`) and pauses
 * links of tasks that no longer do. Publishes `task.updated` per task whose
 * links changed and `project.updated` once.
 */
@Injectable()
export class SyncReconciler {
  private readonly logger = new Logger(SyncReconciler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly registry: IntegrationPluginRegistry,
  ) {}

  async reconcileTaskSync(
    projectId: string,
    taskId: string,
    onlyIntegrationId?: string,
  ): Promise<void> {
    const integrations = await getSyncIntegrations(
      this.dataSource.manager,
      projectId,
      onlyIntegrationId,
    );
    if (await this.reconcileTask(projectId, taskId, integrations))
      await this.events.publish("project.updated", { projectId });
  }

  async reconcileProjectSync(
    projectId: string,
    integrationId?: string,
  ): Promise<void> {
    const db = this.dataSource.manager;
    const integrations = await getSyncIntegrations(db, projectId, integrationId);
    if (!integrations.length) return;
    const [project] = (await db.query(
      `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1`,
      [projectId],
    )) as { workspaceId: string }[];
    if (!project) return;
    let changed = false;
    try {
      for (const integration of integrations) {
        const scope = await outgoingPredicate(
          db,
          project.workspaceId,
          readSyncRules(integration.config)!.outgoing,
        );
        let cursor: string | undefined;
        for (;;) {
          const tasks = await runSql<{ id: string }>(
            db,
            sql`select task.id from task
                where task.project_id = ${projectId}
                  and ${reconciliationPredicate(integration.id, scope.predicate)}
                  ${cursor ? sql`and task.id > ${cursor}` : sql``}
                order by task.id asc
                limit 50`,
          );
          if (!tasks.length) break;
          for (const task of tasks) {
            try {
              if (await this.reconcileTask(projectId, task.id, [integration]))
                changed = true;
            } catch {
              this.logReconcileFailure(projectId, task.id, integration.id);
            }
          }
          cursor = tasks.at(-1)?.id;
        }
      }
    } finally {
      if (changed) await this.events.publish("project.updated", { projectId });
    }
  }

  private async reconcileTask(
    projectId: string,
    taskId: string,
    integrations: SyncIntegration[],
  ): Promise<boolean> {
    if (!integrations.length) return false;
    const db = this.dataSource.manager;
    const links = () =>
      db.find(ExternalLinkEntity, {
        where: { taskId, resourceType: "issue" },
        select: { id: true, metadata: true },
        order: { id: "ASC" },
      });
    const before = await links();
    for (const integration of integrations) {
      try {
        if (
          !(await canSyncTask(db, taskId, integration.id, integration.config))
        )
          continue;
        const plugin = this.registry.get(integration.type);
        if (!plugin?.onTaskCreated) continue;
        const task = await findLinkedTask(db, taskId, projectId);
        if (!task || task.number === null) continue;
        await plugin.onTaskCreated(
          {
            taskId: task.id,
            projectId,
            userId: task.userId ?? "",
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: task.status,
            number: task.number,
          },
          {
            integrationId: integration.id,
            projectId,
            config: integration.parsedConfig,
          },
        );
      } catch {
        this.logReconcileFailure(projectId, taskId, integration.id);
      }
    }
    if (JSON.stringify(before) !== JSON.stringify(await links())) {
      await this.events.publish("task.updated", { projectId, taskId });
      return true;
    }
    return false;
  }

  private logReconcileFailure(
    projectId: string,
    taskId: string,
    integrationId: string,
  ) {
    this.logger.error(
      `Task sync reconciliation failed (project ${projectId}, task ${taskId}, integration ${integrationId})`,
    );
  }
}
