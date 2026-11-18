import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { HTTPException } from "../common/errors/http-exception";
import { LabelEntity } from "../database/entities/label.entity";

@Injectable()
export class LabelQueryService {
  constructor(
    @InjectRepository(LabelEntity)
    private readonly labels: Repository<LabelEntity>,
  ) {}

  async getLabel(id: string): Promise<LabelEntity> {
    const label = await this.labels.findOne({ where: { id } });

    if (!label) {
      throw new HTTPException(404, {
        message: "Label not found",
      });
    }

    return label;
  }

  getLabelsByTaskId(taskId: string): Promise<LabelEntity[]> {
    return this.labels.find({ where: { taskId } });
  }

  /** Workspace labels, plus task labels on projects the user may see. */
  getLabelsByWorkspaceId(
    workspaceId: string,
    userId: string,
  ): Promise<LabelEntity[]> {
    return this.labels
      .createQueryBuilder("label")
      .where("label.workspaceId = :workspaceId", { workspaceId })
      .andWhere(
        `(label.task_id IS NULL OR EXISTS (
          SELECT 1 FROM task AS label_task
          WHERE label_task.id = label.task_id
            AND ${projectAccessCondition(":userId", "label_task.project_id")}
        ))`,
        { userId },
      )
      .getMany();
  }
}
