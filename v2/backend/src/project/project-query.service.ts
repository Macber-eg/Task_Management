import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { HTTPException } from "../common/errors/http-exception";
import { ProjectEntity } from "../database/entities/project.entity";
import { EMPTY_STATISTICS, getProjectStatistics } from "./project-statistics";

@Injectable()
export class ProjectQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** The workspace's projects the user may see, in sidebar order. */
  async getProjects(
    workspaceId: string,
    userId: string,
    includeArchived = false,
  ) {
    const manager = this.dataSource.manager;
    const query = manager
      .createQueryBuilder(ProjectEntity, "project")
      .where("project.workspaceId = :workspaceId", { workspaceId })
      .andWhere(projectAccessCondition(":userId", "project.id"), { userId });
    if (!includeArchived) query.andWhere("project.archivedAt IS NULL");

    // `id` is the deterministic tie-breaker for equal position and createdAt.
    const projects = await query
      .orderBy("project.position", "ASC")
      .addOrderBy("project.createdAt", "ASC")
      .addOrderBy("project.id", "ASC")
      .getMany();

    const statisticsByProject = await getProjectStatistics(
      manager,
      workspaceId,
      userId,
      includeArchived,
    );

    return projects.map((project) => ({
      ...project,
      statistics: statisticsByProject.get(project.id) ?? EMPTY_STATISTICS,
      archivedTasks: [],
      plannedTasks: [],
      columns: [],
    }));
  }

  async getProject(id: string, workspaceId: string): Promise<ProjectEntity> {
    const project = await this.dataSource.manager.findOne(ProjectEntity, {
      where: { id, workspaceId },
    });

    if (!project) {
      throw new HTTPException(404, {
        message: "Project not found",
      });
    }

    return project;
  }
}
