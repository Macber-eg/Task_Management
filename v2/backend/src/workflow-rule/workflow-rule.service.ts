import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning, updateReturning } from "../database/dml";
import { ColumnEntity } from "../database/entities/column.entity";
import { WorkflowRuleEntity } from "../database/entities/workflow-rule.entity";

export type WorkflowRuleTarget = {
  projectId: string;
  integrationType: string;
  eventType: string;
  columnId: string;
};

type WorkflowRuleWithColumn = Omit<WorkflowRuleEntity, "project" | "column"> & {
  columnName: string | null;
  columnSlug: string | null;
};

@Injectable()
export class WorkflowRuleService {
  constructor(private readonly dataSource: DataSource) {}

  getWorkflowRules(projectId: string): Promise<WorkflowRuleWithColumn[]> {
    return this.dataSource.manager.query(
      `SELECT rule.id, rule.project_id AS "projectId",
              rule.integration_type AS "integrationType",
              rule.event_type AS "eventType", rule.column_id AS "columnId",
              "column".name AS "columnName", "column".slug AS "columnSlug",
              rule.created_at AS "createdAt", rule.updated_at AS "updatedAt"
       FROM workflow_rule AS rule
       LEFT JOIN "column" ON rule.column_id = "column".id
       WHERE rule.project_id = $1`,
      [projectId],
    );
  }

  /** One rule per project, integration and event: the column is replaced. */
  async upsertWorkflowRule({
    projectId,
    integrationType,
    eventType,
    columnId,
  }: WorkflowRuleTarget): Promise<WorkflowRuleEntity> {
    const manager = this.dataSource.manager;
    const targetColumn = await manager.findOne(ColumnEntity, {
      where: { id: columnId, projectId },
    });

    if (!targetColumn) {
      throw new HTTPException(400, {
        message: "Column does not belong to the provided project",
      });
    }

    const existing = await manager.findOne(WorkflowRuleEntity, {
      where: { projectId, integrationType, eventType },
    });

    if (existing) {
      const [updated] = await updateReturning(
        manager,
        WorkflowRuleEntity,
        { columnId },
        { id: existing.id },
      );

      if (!updated) {
        throw new HTTPException(500, {
          message: "Failed to update workflow rule",
        });
      }

      return updated;
    }

    const created = await insertReturning(manager, WorkflowRuleEntity, {
      projectId,
      integrationType,
      eventType,
      columnId,
    });

    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create workflow rule",
      });
    }

    return created;
  }

  async deleteWorkflowRule(id: string): Promise<WorkflowRuleEntity> {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(WorkflowRuleEntity, {
      where: { id },
    });

    if (!existing) {
      throw new HTTPException(404, { message: "Workflow rule not found" });
    }

    await manager.delete(WorkflowRuleEntity, { id });

    return existing;
  }
}
