import type { Logger } from "@nestjs/common";
import { HTTPException } from "../../common/errors/http-exception";
import type { ObjectStore } from "../object-store/object-store";
import type { ValidatedUpload } from "./validate-upload";

/** Writes an upload's bytes; provider errors never reach the client. */
export async function putUpload(
  store: ObjectStore,
  logger: Logger,
  key: string,
  upload: ValidatedUpload,
): Promise<void> {
  try {
    await store.put(key, upload.body, upload.contentType);
  } catch (error) {
    logger.error(
      `Failed to store an upload (${error instanceof Error ? error.name : "unknown error"})`,
    );
    throw new HTTPException(503, {
      message: "Unable to store the uploaded file.",
    });
  }
}
