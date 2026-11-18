import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { ProjectEntity } from "../../database/entities/project.entity";
import { EventBus } from "../../events/event-bus";
import { StorageCleanupQueue } from "../cleanup/storage-cleanup-queue.service";
import { StorageObjectLock } from "../cleanup/storage-object-lock";
import {
  applyKeyPrefix,
  buildProjectBackgroundObjectKey,
} from "../object-store/object-keys";
import { ObjectStore } from "../object-store/object-store";
import { storageKeyPrefix } from "../object-store/storage-config";
import { putUpload } from "../upload/put-upload";
import type { ValidatedUpload } from "../upload/validate-upload";

type Background = { backgroundObjectKey: string | null };

function lockProjectBackground(
  manager: EntityManager,
  projectId: string,
): Promise<Background[]> {
  return manager.query(
    `SELECT background_object_key AS "backgroundObjectKey"
     FROM project WHERE id = $1 FOR UPDATE`,
    [projectId],
  ) as Promise<Background[]>;
}

/**
 * A project's board background. Each upload gets a new versioned key; the
 * replaced object is queued for cleanup in the same transaction, then
 * removed straight away when the bucket allows.
 */
@Injectable()
export class ProjectBackgroundService {
  private readonly logger = new Logger(ProjectBackgroundService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lock: StorageObjectLock,
    private readonly store: ObjectStore,
    private readonly cleanupQueue: StorageCleanupQueue,
    private readonly events: EventBus,
  ) {}

  /** Returns the new background version. */
  async replace(projectId: string, upload: ValidatedUpload): Promise<string> {
    const project = await this.dataSource.manager.findOne(ProjectEntity, {
      select: { id: true, workspaceId: true },
      where: { id: projectId },
    });
    if (!project) throw new HTTPException(404, { message: "Project not found" });

    const { rawKey, version } = buildProjectBackgroundObjectKey({
      workspaceId: project.workspaceId,
      projectId,
    });
    const key = applyKeyPrefix(storageKeyPrefix(), rawKey);

    const previousKey = await this.lock.withUploadedObject(
      key,
      () => putUpload(this.store, this.logger, key, upload),
      async (manager) => {
        const [current] = await lockProjectBackground(manager, projectId);
        if (!current)
          throw new HTTPException(404, { message: "Project not found" });
        await manager.update(
          ProjectEntity,
          { id: projectId },
          {
            backgroundObjectKey: key,
            backgroundMimeType: upload.contentType,
            backgroundVersion: version,
          },
        );
        const previous = current.backgroundObjectKey;
        if (previous && previous !== key)
          await this.cleanupQueue.queue(manager, [previous]);
        return previous !== key ? previous : null;
      },
    );

    await this.removeNow(previousKey);
    await this.events.publish("project.updated", { projectId });
    return version;
  }

  async remove(projectId: string): Promise<void> {
    const removed = await this.dataSource.transaction(async (manager) => {
      const [current] = await lockProjectBackground(manager, projectId);
      if (!current) return null;
      await manager.update(
        ProjectEntity,
        { id: projectId },
        {
          backgroundObjectKey: null,
          backgroundMimeType: null,
          backgroundVersion: null,
        },
      );
      if (current.backgroundObjectKey)
        await this.cleanupQueue.queue(manager, [current.backgroundObjectKey]);
      return current;
    });
    if (!removed) return;

    await this.removeNow(removed.backgroundObjectKey);
    await this.events.publish("project.updated", { projectId });
  }

  /** Best effort: whatever fails here stays queued for the cleanup job. */
  private async removeNow(key: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.cleanupQueue.processKey(key);
    } catch (error) {
      this.logger.warn(
        `Background cleanup deferred (${error instanceof Error ? error.name : "unknown error"})`,
      );
    }
  }
}
