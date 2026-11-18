import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { Request } from "express";
import { catchError, type Observable, throwError } from "rxjs";
import { HTTPException } from "../../common/errors/http-exception";
import { ObjectStore } from "../object-store/object-store";
import {
  maxImageUploadBytes,
  StorageNotConfiguredError,
} from "../object-store/storage-config";
import { uploadTooLargeMessage } from "./upload-limits";

/**
 * Runs after the access guards and before the body is read: refuses
 * anything but `multipart/form-data`, and an instance without storage, so
 * neither buffers an upload it cannot accept. Maps multer's size limit to
 * the API's message.
 */
@Injectable()
export class MultipartUploadInterceptor implements NestInterceptor {
  constructor(private readonly store: ObjectStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.is("multipart/form-data")) {
      throw new HTTPException(415, {
        message: "Upload the file as multipart/form-data.",
      });
    }
    try {
      this.store.assertConfigured();
    } catch (error) {
      throw new HTTPException(503, {
        message:
          error instanceof StorageNotConfiguredError
            ? error.message
            : "Image uploads are not configured",
      });
    }
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new HTTPException(413, {
                message: uploadTooLargeMessage(maxImageUploadBytes()),
              })
            : error,
        ),
      ),
    );
  }
}
