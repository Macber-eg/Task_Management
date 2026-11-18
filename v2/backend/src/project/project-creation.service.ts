import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { ProjectEntity } from "../database/entities/project.entity";
import { insertProject, type NewProject } from "./insert-project";

@Injectable()
export class ProjectCreationService {
  constructor(private readonly dataSource: DataSource) {}

  createProject(project: NewProject): Promise<ProjectEntity | undefined> {
    return this.dataSource.transaction((tx) => insertProject(tx, project));
  }
}
