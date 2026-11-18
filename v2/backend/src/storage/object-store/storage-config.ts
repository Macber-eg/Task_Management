const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  maxImageUploadBytes: number;
};

/** Raised when S3 is not configured; uploads answer 503 with its message. */
export class StorageNotConfiguredError extends Error {}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Both keys pin static credentials; neither leaves the AWS SDK's default
 * provider chain (instance profile, ECS task role, EKS IRSA, environment).
 * Exactly one is almost always a misconfiguration, so it throws.
 */
export function resolveS3Credentials(
  accessKeyId: string,
  secretAccessKey: string,
): { accessKeyId: string; secretAccessKey: string } | undefined {
  const hasAccessKeyId = Boolean(accessKeyId);
  const hasSecretAccessKey = Boolean(secretAccessKey);

  if (hasAccessKeyId !== hasSecretAccessKey) {
    throw new StorageNotConfiguredError(
      "Incomplete S3 credentials. Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain (IAM role / IRSA / environment).",
    );
  }

  if (hasAccessKeyId && hasSecretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }

  return undefined;
}

export function maxImageUploadBytes() {
  return parsePositiveInt(
    process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
    DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  );
}

export function storageKeyPrefix() {
  return env("S3_KEY_PREFIX");
}

export function readStorageConfig(): StorageConfig {
  const endpoint = env("S3_ENDPOINT");
  const bucket = env("S3_BUCKET");
  const accessKeyId = env("S3_ACCESS_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY");

  if (!endpoint || !bucket) {
    throw new StorageNotConfiguredError(
      "S3 uploads are not configured. Set S3_ENDPOINT and S3_BUCKET (and either both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain / IAM role).",
    );
  }

  // Surfaces a half-set key pair here rather than as an opaque signing error.
  resolveS3Credentials(accessKeyId, secretAccessKey);

  return {
    endpoint,
    region: env("S3_REGION") || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env("S3_PUBLIC_BASE_URL") || undefined,
    keyPrefix: storageKeyPrefix(),
    forcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, true),
    maxImageUploadBytes: maxImageUploadBytes(),
  };
}
