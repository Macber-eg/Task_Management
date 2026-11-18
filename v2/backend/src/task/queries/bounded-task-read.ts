import type { DataSource, EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";

const QUERY_CANCELED = "57014";

function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, driverError } = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return code === QUERY_CANCELED || driverError?.code === QUERY_CANCELED;
}

/**
 * A consistent, read-only snapshot capped at three seconds, so large boards
 * and descriptions cannot hold a connection; a timeout answers 503.
 */
export async function boundedTaskRead<T>(
  dataSource: DataSource,
  read: (tx: EntityManager) => Promise<T>,
  message = "Description request took too long; retry later",
): Promise<T> {
  try {
    return await dataSource.transaction("REPEATABLE READ", async (tx) => {
      await tx.query("SET TRANSACTION READ ONLY");
      await tx.query("SET LOCAL statement_timeout = '3s'");
      return read(tx);
    });
  } catch (error) {
    if (isStatementTimeout(error)) throw new HTTPException(503, { message });
    throw error;
  }
}
