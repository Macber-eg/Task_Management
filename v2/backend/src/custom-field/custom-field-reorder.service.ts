import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { CustomFieldDefinitionEntity } from "../database/entities/custom-field-definition.entity";

@Injectable()
export class CustomFieldReorderService {
  constructor(private readonly dataSource: DataSource) {}

  async reorderCustomFields(
    projectId: string,
    customFields: Array<{ id: string; position: number }>,
  ): Promise<CustomFieldDefinitionEntity[]> {
    await this.dataSource.transaction(async (tx) => {
      for (const field of customFields) {
        const [updated] = await updateReturning(
          tx,
          CustomFieldDefinitionEntity,
          { position: field.position },
          { id: field.id, projectId },
        );

        if (!updated) {
          throw new HTTPException(400, {
            message: `Custom field ${field.id} does not belong to this project`,
          });
        }
      }
    });

    return this.dataSource.manager.find(CustomFieldDefinitionEntity, {
      where: { projectId },
      order: { position: "ASC" },
    });
  }
}
