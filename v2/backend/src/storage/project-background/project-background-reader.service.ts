import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { ProjectEntity } from "../../database/entities/project.entity";
import {
  baseContentType,
  isImageContentType,
} from "../object-store/image-content-types";
import { ObjectStore, type StoredObject } from "../object-store/object-store";

export type OpenedBackground = {
  object: StoredObject;
  headers: Record<string, string>;
};

function notFound() {
  return new HTTPException(404, { message: "Project background not found" });
}

/** Opens a project's background for download, with its response headers. */
@Injectable()
export class ProjectBackgroundReader {
  private readonly logger = new Logger(ProjectBackgroundReader.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly store: ObjectStore,
  ) {}

  async open(projectId: string): Promise<OpenedBackground> {
    const project = await this.dataSource.manager.findOne(ProjectEntity, {
      select: {
        id: true,
        backgroundObjectKey: true,
        backgroundMimeType: true,
        backgroundVersion: true,
      },
      where: { id: projectId },
    });
    if (!project?.backgroundObjectKey) throw notFound();

    let object: StoredObject;
    try {
      object = await this.store.get(project.backgroundObjectKey);
    } catch (error) {
      this.logger.error(
        `Failed to stream project background (${error instanceof Error ? error.name : "unknown error"})`,
      );
      throw notFound();
    }

    const contentType = baseContentType(
      object.contentType || project.backgroundMimeType || "",
    );
    if (!contentType || !isImageContentType(contentType)) {
      object.body.destroy();
      throw notFound();
    }

    const headers: Record<string, string> = {
      "Cache-Control": "private, max-age=300, must-revalidate",
      "Content-Type": contentType,
      ETag: object.etag || `"${project.backgroundVersion}"`,
      Vary: "Cookie, Authorization",
      "X-Content-Type-Options": "nosniff",
    };
    if (object.contentLength !== undefined)
      headers["Content-Length"] = object.contentLength.toString();
    if (object.lastModified)
      headers["Last-Modified"] = object.lastModified.toUTCString();
    return { object, headers };
  }
}
