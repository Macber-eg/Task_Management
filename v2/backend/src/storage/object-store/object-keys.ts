import { createId } from "@paralleldrive/cuid2";
import { storageKeyPrefix } from "./storage-config";

export type UploadSurface = "description" | "comment";

type TaskObjectScope = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  surface: UploadSurface;
};

type ProjectObjectScope = { workspaceId: string; projectId: string };

export function sanitizePathSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "file"
  );
}

export function getFileExtension(filename: string) {
  const normalized = filename.trim();
  const extension = normalized.includes(".")
    ? normalized.split(".").pop() || ""
    : "";

  return sanitizePathSegment(extension).slice(0, 12);
}

export function applyKeyPrefix(prefix: string, key: string) {
  if (!prefix) return key;
  const trimmed = prefix.replace(/\/+$/, "");
  return `${trimmed}/${key}`;
}

export function buildObjectKeyPrefix(scope: TaskObjectScope) {
  const surfaceFolder =
    scope.surface === "comment" ? "comments" : "descriptions";

  return [
    "workspace",
    sanitizePathSegment(scope.workspaceId),
    "project",
    sanitizePathSegment(scope.projectId),
    "task",
    sanitizePathSegment(scope.taskId),
    surfaceFolder,
  ].join("/");
}

/** A new key for a task asset, without the `S3_KEY_PREFIX`. */
export function buildObjectKey(scope: TaskObjectScope & { filename: string }) {
  const extension = getFileExtension(scope.filename);
  const objectKeyPrefix = buildObjectKeyPrefix(scope);
  const timestamp = Date.now();
  const randomId = createId();

  const baseName = sanitizePathSegment(
    scope.filename.replace(/\.[^/.]+$/, "") || "image",
  ).slice(0, 64);

  const fileName = extension
    ? `${baseName}-${timestamp}-${randomId}.${extension}`
    : `${baseName}-${timestamp}-${randomId}`;

  return `${objectKeyPrefix}/${fileName}`;
}

/** A new key for a task asset, `S3_KEY_PREFIX` applied. */
export function buildStorageObjectKey(
  scope: TaskObjectScope & { filename: string },
) {
  return applyKeyPrefix(storageKeyPrefix(), buildObjectKey(scope));
}

export function buildProjectBackgroundObjectKeyPrefix(
  scope: ProjectObjectScope,
) {
  return [
    "workspace",
    sanitizePathSegment(scope.workspaceId),
    "project",
    sanitizePathSegment(scope.projectId),
    "backgrounds",
  ].join("/");
}

export function buildProjectBackgroundObjectKey(scope: ProjectObjectScope) {
  const version = createId();
  return {
    rawKey: `${buildProjectBackgroundObjectKeyPrefix(scope)}/background-${version}`,
    version,
  };
}
