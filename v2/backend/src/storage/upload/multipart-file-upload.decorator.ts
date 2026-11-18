import { applyDecorators, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { maxImageUploadBytes } from "../object-store/storage-config";
import { MultipartUploadInterceptor } from "./multipart-upload.interceptor";

/**
 * One file in the `file` field, held in memory (multer's default storage)
 * and capped at `S3_MAX_IMAGE_UPLOAD_BYTES`, read per request. Interceptors
 * run after the access guards, so nothing is buffered for a refused caller.
 */
export function MultipartFileUpload() {
  return applyDecorators(
    UseInterceptors(
      MultipartUploadInterceptor,
      FileInterceptor("file", {
        limits: () => ({
          fileSize: maxImageUploadBytes(),
          files: 1,
          fields: 10,
        }),
        defParamCharset: "utf8",
      }),
    ),
  );
}
