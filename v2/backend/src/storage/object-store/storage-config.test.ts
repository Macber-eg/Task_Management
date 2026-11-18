import { afterEach, describe, expect, it, vi } from "vitest";
import { isImageContentType } from "./image-content-types";
import {
  maxImageUploadBytes,
  parseBoolean,
  parsePositiveInt,
  readStorageConfig,
  resolveS3Credentials,
} from "./storage-config";

describe("storage config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recognizes allowed image content types case-insensitively", () => {
    expect(isImageContentType("IMAGE/PNG")).toBe(true);
    expect(isImageContentType("image/svg+xml")).toBe(false);
    expect(isImageContentType("text/plain")).toBe(false);
  });

  it("parses booleans and positive integers with fallbacks", () => {
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean(" false ", true)).toBe(false);
    expect(parsePositiveInt("42", 10)).toBe(42);
    expect(parsePositiveInt("0", 10)).toBe(10);
    expect(parsePositiveInt("nope", 10)).toBe(10);
  });

  it("reads the upload limit, 10 MiB by default", () => {
    vi.stubEnv("S3_MAX_IMAGE_UPLOAD_BYTES", "");
    expect(maxImageUploadBytes()).toBe(10 * 1024 * 1024);
    vi.stubEnv("S3_MAX_IMAGE_UPLOAD_BYTES", "1048576");
    expect(maxImageUploadBytes()).toBe(1048576);
  });

  it("resolveS3Credentials pins both keys, defers to the provider chain without them, and refuses one", () => {
    expect(resolveS3Credentials("AKIA", "secret")).toEqual({
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
    });
    expect(resolveS3Credentials("", "")).toBeUndefined();
    expect(() => resolveS3Credentials("AKIA", "")).toThrow(
      /both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/,
    );
    expect(() => resolveS3Credentials("", "secret")).toThrow(
      /both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/,
    );
  });

  it("succeeds without static keys (IAM role mode)", () => {
    vi.stubEnv("S3_ENDPOINT", "https://s3.us-east-1.amazonaws.com");
    vi.stubEnv("S3_BUCKET", "kaneo");
    vi.stubEnv("S3_ACCESS_KEY_ID", "");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "");
    vi.stubEnv("S3_REGION", "");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "");

    expect(readStorageConfig()).toMatchObject({
      bucket: "kaneo",
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      forcePathStyle: true,
    });
  });

  it("throws when only one credential key is set", () => {
    vi.stubEnv("S3_ENDPOINT", "https://s3.us-east-1.amazonaws.com");
    vi.stubEnv("S3_BUCKET", "kaneo");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIA");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "");

    expect(() => readStorageConfig()).toThrow(/Incomplete S3 credentials/);
  });

  it("throws when endpoint or bucket is missing", () => {
    vi.stubEnv("S3_ENDPOINT", "");
    vi.stubEnv("S3_BUCKET", "");

    expect(() => readStorageConfig()).toThrow(/S3 uploads are not configured/);
  });
});
