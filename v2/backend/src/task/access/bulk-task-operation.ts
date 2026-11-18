import type { ApiRequest } from "../../auth/principal";
import { HTTPException } from "../../common/errors/http-exception";
import {
  BULK_OPERATIONS,
  type BulkOperation,
} from "../mutations/bulk/bulk-task";
import { jsonBody } from "./json-body";

/** The operation a bulk request names, checked before the body is validated. */
export function bulkTaskOperation(request: ApiRequest): BulkOperation {
  const { operation } = jsonBody(request);
  if (
    typeof operation !== "string" ||
    !(BULK_OPERATIONS as readonly string[]).includes(operation)
  ) {
    throw new HTTPException(400, {
      message: `operation must be one of: ${BULK_OPERATIONS.join(", ")}`,
    });
  }
  return operation as BulkOperation;
}
