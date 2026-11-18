import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "../../../database/dml";
import { IntegrationEntity } from "../../../database/entities/integration.entity";

/** The one integration row of a type a project may have. */
@Injectable()
export class ProjectIntegrationStore {
  constructor(private readonly dataSource: DataSource) {}

  async find(
    projectId: string,
    type: string,
  ): Promise<IntegrationEntity | null> {
    return this.dataSource.manager.findOne(IntegrationEntity, {
      where: { projectId, type },
    });
  }

  async insert(projectId: string, type: string, config: unknown) {
    await insertReturning(this.dataSource.manager, IntegrationEntity, {
      projectId,
      type,
      config: JSON.stringify(config),
      isActive: true,
    });
  }

  /**
   * Inserts the row, or on (project, type) conflict replaces its config and
   * also re-activates it when `activate` is set.
   */
  async upsert(
    projectId: string,
    type: string,
    config: unknown,
    { activate }: { activate: boolean },
  ) {
    await insertReturning(
      this.dataSource.manager,
      IntegrationEntity,
      {
        projectId,
        type,
        config: JSON.stringify(config),
        isActive: true,
        updatedAt: new Date(),
      },
      {
        onConflict: {
          target: ["projectId", "type"],
          update: activate
            ? ["config", "isActive", "updatedAt"]
            : ["config", "updatedAt"],
        },
      },
    );
  }

  async update(
    id: string,
    values: { config: unknown; isActive?: boolean | null },
  ) {
    await updateReturning(
      this.dataSource.manager,
      IntegrationEntity,
      {
        config: JSON.stringify(values.config),
        ...(values.isActive !== undefined ? { isActive: values.isActive } : {}),
      },
      { id },
    );
  }

  async delete(id: string) {
    await deleteReturning(this.dataSource.manager, IntegrationEntity, { id });
  }
}
