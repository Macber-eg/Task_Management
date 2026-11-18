import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import {
  type ObjectMetadata,
  ObjectStore,
  type StoredObject,
} from "./object-store";
import {
  readStorageConfig,
  resolveS3Credentials,
  type StorageConfig,
} from "./storage-config";

const PROVIDER_TIMEOUT_MS = 10_000;

function isNotFound(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  return error.name === "NotFound" || error.name === "NoSuchKey" || status === 404;
}

function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (
    body &&
    typeof body === "object" &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    return Readable.fromWeb(
      (body as { transformToWebStream(): WebReadableStream }).transformToWebStream(),
    );
  }
  throw new Error("Storage object body is not a stream.");
}

/** S3 (or an S3-compatible service) configured from the `S3_*` variables. */
@Injectable()
export class S3ObjectStore extends ObjectStore {
  private cached: { cacheKey: string; client: S3Client } | undefined;

  assertConfigured(): void {
    readStorageConfig();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, config } = this.connect();
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const { client, config } = this.connect();
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    if (!response.Body) throw new Error("Storage object body is missing.");
    return {
      body: toReadable(response.Body),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      etag: response.ETag,
      lastModified: response.LastModified,
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const { client, config } = this.connect();
    try {
      const object = await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) },
      );
      return {
        contentType: object.ContentType,
        contentLength: object.ContentLength,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { client, config } = this.connect();
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
    );
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const { client, config } = this.connect();
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        CopySource: [config.bucket, ...sourceKey.split("/")]
          .map(encodeURIComponent)
          .join("/"),
        Key: destinationKey,
      }),
    );
  }

  private connect(): { client: S3Client; config: StorageConfig } {
    const config = readStorageConfig();
    const cacheKey = JSON.stringify({
      endpoint: config.endpoint,
      region: config.region,
      accessKeyId: config.accessKeyId,
      bucket: config.bucket,
      forcePathStyle: config.forcePathStyle,
    });
    if (this.cached?.cacheKey === cacheKey) {
      return { client: this.cached.client, config };
    }

    const clientConfig: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      // Some S3-compatible providers (e.g. Garage, R2) reject the checksum
      // parameters the SDK would otherwise add to every request.
      requestChecksumCalculation: "WHEN_REQUIRED",
    };
    // Left unset without both keys, so the SDK's provider chain (IAM role)
    // supplies them.
    const credentials = resolveS3Credentials(
      config.accessKeyId,
      config.secretAccessKey,
    );
    if (credentials) clientConfig.credentials = credentials;

    const client = new S3Client(clientConfig);
    this.cached = { cacheKey, client };
    return { client, config };
  }
}
