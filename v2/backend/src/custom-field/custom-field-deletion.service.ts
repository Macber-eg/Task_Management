import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { deleteReturning } from "../database/dml";
import { CustomFieldDefinitionEntity } from "../database/entities/custom-field-definition.entity";

@Injectable()
export class CustomFieldDeletionService {
  constructor(private readonly dataSource: DataSource) {}

  async deleteCustomField(
    id: string,
  ): Promise<CustomFieldDefinitionEntity & { workspaceId: string }> {
    const manager = this.dataSource.manager;
    const [field] = (await manager.query(
      `SELECT f.project_id AS "projectId", p.workspace_id AS "workspaceId"
       FROM custom_field_definition AS f
       INNER JOIN project AS p ON p.id = f.project_id
       WHERE f.id = $1
       LIMIT 1`,
      [id],
    )) as { projectId: string; workspaceId: string | null }[];

    if (!field) {
      throw new HTTPException(404, {
        message: "Custom field or project not found",
      });
    }

    if (!field.workspaceId) {
      throw new HTTPException(400, {
        message: "The project is not associated with a workspace",
      });
    }

    const [deleted] = await deleteReturning(
      manager,
      CustomFieldDefinitionEntity,
      { id },
    );

    if (!deleted) {
      throw new HTTPException(404, {
        message: "Custom field not found",
      });
    }

    return {
      ...deleted,
      workspaceId: field.workspaceId,
    };
  }
}
