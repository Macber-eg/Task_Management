import { pipeline } from "node:stream/promises";
import type { Logger } from "@nestjs/common";
import type { Response } from "express";
import type { StoredObject } from "../object-store/object-store";

/**
 * Sends a stored object's body. Headers are already out once this starts,
 * so a storage failure mid-stream can only cut the response short.
 */
export async function streamObject(
  response: Response,
  object: StoredObject,
  logger: Logger,
): Promise<void> {
  try {
    await pipeline(object.body, response);
  } catch (error) {
    // A client that disconnects is routine; provider messages may carry
    // endpoints, so only the error's name is logged.
    if (!response.writableFinished) {
      logger.warn(
        `Stopped streaming a storage object (${error instanceof Error ? error.name : "unknown error"})`,
      );
    }
  }
}
