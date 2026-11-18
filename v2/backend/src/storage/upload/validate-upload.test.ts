import { afterEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "../../common/errors/http-exception";
import {
  type ReceivedFile,
  validateBackgroundUpload,
  validateTaskUpload,
} from "./validate-upload";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function file(overrides: Partial<ReceivedFile> = {}): ReceivedFile {
  const buffer = overrides.buffer ?? PNG;
  return {
    buffer,
    originalname: "image.png",
    mimetype: "image/png",
    size: buffer.length,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(HTTPException);
  const { status, message } = error as HTTPException;
  return { status, message };
}

describe("validateTaskUpload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts images checked by content and any other type as is", async () => {
    await expect(validateTaskUpload(file())).resolves.toMatchObject({
      contentType: "image/png",
      filename: "image.png",
      size: PNG.length,
    });
    await expect(
      validateTaskUpload(
        file({
          buffer: Buffer.from("plain"),
          size: 5,
          mimetype: "text/plain",
          originalname: "",
        }),
      ),
    ).resolves.toMatchObject({ contentType: "text/plain", filename: "file" });
  });

  it("keeps the previous messages for missing type, empty and oversized files", async () => {
    vi.stubEnv("S3_MAX_IMAGE_UPLOAD_BYTES", "1048576");
    expect(await rejection(validateTaskUpload(undefined))).toMatchObject({
      status: 400,
    });
    expect(
      await rejection(validateTaskUpload(file({ mimetype: " " }))),
    ).toEqual({ status: 400, message: "A valid content type is required." });
    expect(await rejection(validateTaskUpload(file({ size: 0 })))).toEqual({
      status: 400,
      message: "Upload size must be a positive safe integer.",
    });
    expect(
      await rejection(validateTaskUpload(file({ size: 2 * 1024 * 1024 }))),
    ).toEqual({
      status: 413,
      message: "Upload exceeds the maximum upload size of 1MB.",
    });
  });

  it("rejects image claims the bytes do not back", async () => {
    expect(
      await rejection(
        validateTaskUpload(file({ buffer: Buffer.from("<svg/>"), size: 6 })),
      ),
    ).toEqual({
      status: 400,
      message: "The file content does not match its image type.",
    });
  });
});

describe("validateBackgroundUpload", () => {
  it("only accepts supported images", async () => {
    await expect(validateBackgroundUpload(file())).resolves.toMatchObject({
      contentType: "image/png",
    });
    expect(
      await rejection(
        validateBackgroundUpload(file({ mimetype: "application/pdf" })),
      ),
    ).toEqual({
      status: 400,
      message:
        'Unsupported content type "application/pdf". Upload a supported image.',
    });
    expect(
      await rejection(validateBackgroundUpload(file({ size: 0 }))),
    ).toEqual({ status: 400, message: "Upload size must be greater than zero." });
  });
});
