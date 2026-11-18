export type TaskAssetCopy = {
  sourceKey: string;
  destination: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    surface: "comment" | "description";
    filename: string;
    contentType: string;
  };
};

/**
 * What tasks ask of object storage (S3). The storage feature should provide
 * it; each method matches one call of the previous task code.
 */
export abstract class TaskAssetStorage {
  /** Copies a stored object for a duplicated task; returns the new key. */
  abstract copyTaskAssetObject(copy: TaskAssetCopy): Promise<string>;

  abstract deleteObject(objectKey: string): Promise<void>;

  /**
   * Deletes the assets an edit removed from a task description, unless the
   * task still references them elsewhere. Fire-and-forget at the call site.
   */
  abstract deleteOrphanedAssets(
    oldContent: string | null | undefined,
    newContent: string | null | undefined,
    scope: { taskId: string },
  ): Promise<void>;
}
