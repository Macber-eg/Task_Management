import type { DataSource, EntityManager } from "typeorm";
import { vi } from "vitest";

type Run = (tx: EntityManager) => Promise<unknown>;
type Transaction = (...args: unknown[]) => Promise<unknown>;

/**
 * Runs `concurrent` (a write by "someone else") just before the next
 * transaction the application opens, like the previous tests' spy on
 * `db.transaction`.
 */
export function beforeNextTransaction(
  dataSource: DataSource,
  concurrent: () => Promise<unknown>,
): void {
  const original = dataSource.transaction.bind(dataSource) as Transaction;
  vi.spyOn(dataSource, "transaction").mockImplementationOnce((async (
    ...args: unknown[]
  ) => {
    await concurrent();
    return original(...args);
  }) as never);
}

/**
 * Wraps every transaction so `inside()` reports whether the application is
 * currently running one.
 */
export function trackTransactions(dataSource: DataSource) {
  let depth = 0;
  const original = dataSource.transaction.bind(dataSource) as (
    run: Run,
  ) => Promise<unknown>;
  vi.spyOn(dataSource, "transaction").mockImplementation(((run: Run) =>
    original(async (tx) => {
      depth++;
      try {
        return await run(tx);
      } finally {
        depth--;
      }
    })) as never);
  return { inside: () => depth > 0 };
}
