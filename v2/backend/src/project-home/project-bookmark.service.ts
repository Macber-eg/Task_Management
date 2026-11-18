import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "../database/dml";
import { ProjectBookmarkEntity } from "../database/entities/project-bookmark.entity";

/** A user's own bookmarks on a project's home page. */
@Injectable()
export class ProjectBookmarkService {
  constructor(private readonly dataSource: DataSource) {}

  listProjectBookmarks(
    projectId: string,
    userId: string,
  ): Promise<ProjectBookmarkEntity[]> {
    return this.dataSource.manager.find(ProjectBookmarkEntity, {
      where: { projectId, userId },
      order: { updatedAt: "DESC" },
    });
  }

  createProjectBookmark(
    projectId: string,
    userId: string,
    title: string,
    url: string,
  ): Promise<ProjectBookmarkEntity | undefined> {
    return insertReturning(this.dataSource.manager, ProjectBookmarkEntity, {
      projectId,
      userId,
      title: title.trim(),
      url: url.trim(),
    });
  }

  async updateProjectBookmark(
    id: string,
    userId: string,
    title: string,
    url: string,
  ): Promise<ProjectBookmarkEntity> {
    const [row] = await updateReturning(
      this.dataSource.manager,
      ProjectBookmarkEntity,
      { title: title.trim(), url: url.trim() },
      { id, userId },
    );
    if (!row) {
      throw new HTTPException(404, { message: "Bookmark not found" });
    }
    return row;
  }

  async deleteProjectBookmark(
    id: string,
    userId: string,
  ): Promise<ProjectBookmarkEntity> {
    const [row] = await deleteReturning(
      this.dataSource.manager,
      ProjectBookmarkEntity,
      { id, userId },
    );
    if (!row) {
      throw new HTTPException(404, { message: "Bookmark not found" });
    }
    return row;
  }
}
