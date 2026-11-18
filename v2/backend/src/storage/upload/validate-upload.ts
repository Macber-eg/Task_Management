import { fileTypeFromBuffer } from "file-type";
import { HTTPException } from "../../common/errors/http-exception";
import { isImageContentType } from "../object-store/image-content-types";
import { maxImageUploadBytes } from "../object-store/storage-config";
import { uploadTooLargeMessage } from "./upload-limits";

/** The part of multer's memory-storage file the upload routes read. */
export type ReceivedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export type ValidatedUpload = {
  body: Buffer;
  filename: string;
  contentType: string;
  size: number;
};

function badRequest(message: string) {
  return new HTTPException(400, { message });
}

function requireFile(file: ReceivedFile | undefined): ReceivedFile {
  if (!file) throw badRequest('A file is required in the "file" field.');
  return file;
}

function requireWithinLimit(size: number) {
  const maxBytes = maxImageUploadBytes();
  if (size > maxBytes)
    throw new HTTPException(413, { message: uploadTooLargeMessage(maxBytes) });
}

/**
 * A file that claims to be an image must start with that image format's
 * magic bytes; it is then stored under the detected type, so what is later
 * served inline is what the bytes are.
 */
async function sniffImageType(body: Buffer): Promise<string> {
  const detected = await fileTypeFromBuffer(body);
  if (!detected || !isImageContentType(detected.mime))
    throw badRequest("The file content does not match its image type.");
  return detected.mime;
}

/** Task images and attachments: any type, images checked by content. */
export async function validateTaskUpload(
  received: ReceivedFile | undefined,
): Promise<ValidatedUpload> {
  const file = requireFile(received);
  const declared = file.mimetype.trim();
  if (!declared) throw badRequest("A valid content type is required.");
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw badRequest("Upload size must be a positive safe integer.");
  requireWithinLimit(file.size);

  const contentType = isImageContentType(declared)
    ? await sniffImageType(file.buffer)
    : declared;
  return {
    body: file.buffer,
    filename: file.originalname || "file",
    contentType,
    size: file.size,
  };
}

/** Project backgrounds: one of the supported image types only. */
export async function validateBackgroundUpload(
  received: ReceivedFile | undefined,
): Promise<ValidatedUpload> {
  const file = requireFile(received);
  const declared = file.mimetype.trim();
  if (!declared) throw badRequest("A valid content type is required.");
  if (!isImageContentType(declared))
    throw badRequest(
      `Unsupported content type "${declared}". Upload a supported image.`,
    );
  if (file.size <= 0) throw badRequest("Upload size must be greater than zero.");
  requireWithinLimit(file.size);

  return {
    body: file.buffer,
    filename: file.originalname || "background",
    contentType: await sniffImageType(file.buffer),
    size: file.size,
  };
}
