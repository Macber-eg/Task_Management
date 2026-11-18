import type { Readable } from "node:stream";

export type StoredObject = {
  body: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

export type ObjectMetadata = {
  contentType: string | undefined;
  contentLength: number | undefined;
};

/**
 * The bucket uploads and assets live in. Keys are full keys, the
 * `S3_KEY_PREFIX` already applied. Implementations never put provider
 * details (endpoints, signed URLs) in the errors they throw to callers that
 * forward messages to clients; callers map failures to their own messages.
 */
export abstract class ObjectStore {
  /** Throws `StorageNotConfiguredError` when the instance has no storage. */
  abstract assertConfigured(): void;

  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Streams an object; rejects when it does not exist. */
  abstract get(key: string): Promise<StoredObject>;

  /** Null when the object does not exist. */
  abstract head(key: string): Promise<ObjectMetadata | null>;

  /** Succeeds for a missing object too, as S3 does. */
  abstract delete(key: string): Promise<void>;

  abstract copy(sourceKey: string, destinationKey: string): Promise<void>;
}
