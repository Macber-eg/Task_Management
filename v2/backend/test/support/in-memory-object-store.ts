import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  type ObjectMetadata,
  ObjectStore,
  type StoredObject,
} from "../../src/storage/object-store/object-store";
import { StorageNotConfiguredError } from "../../src/storage/object-store/storage-config";

type Entry = { body: Buffer; contentType: string; lastModified: Date };

/**
 * An in-process bucket for integration tests. Use with
 * `createTestApp({ overrides: [[ObjectStore, store]] })`; spy on its methods
 * to inject provider failures.
 */
export class InMemoryObjectStore extends ObjectStore {
  readonly objects = new Map<string, Entry>();
  configured = true;

  assertConfigured(): void {
    if (!this.configured)
      throw new StorageNotConfiguredError(
        "S3 uploads are not configured. Set S3_ENDPOINT and S3_BUCKET.",
      );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, {
      body: Buffer.from(body),
      contentType,
      lastModified: new Date(),
    });
  }

  async get(key: string): Promise<StoredObject> {
    const entry = this.objects.get(key);
    if (!entry)
      throw Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      });
    return {
      body: Readable.from([entry.body]),
      contentType: entry.contentType,
      contentLength: entry.body.length,
      etag: `"${createHash("md5").update(entry.body).digest("hex")}"`,
      lastModified: entry.lastModified,
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const entry = this.objects.get(key);
    return entry
      ? { contentType: entry.contentType, contentLength: entry.body.length }
      : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const entry = this.objects.get(sourceKey);
    if (!entry)
      throw Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      });
    this.objects.set(destinationKey, { ...entry, lastModified: new Date() });
  }

  reset(): void {
    this.objects.clear();
    this.configured = true;
  }
}
