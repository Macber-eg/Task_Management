import type { DataSource, EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";

const QUERY_CANCELED = "57014";

function errorCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const { code, driverError } = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return code ?? driverError?.code;
}

/**
 * Runs a read in one read-only REPEATABLE READ snapshot capped at three
 * seconds, so a paged read sees consistent rows and a slow one answers 503.
 * Same rule as the task area's bounded read.
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
    if (errorCode(error) === QUERY_CANCELED)
      throw new HTTPException(503, { message });
    throw error;
  }
}
