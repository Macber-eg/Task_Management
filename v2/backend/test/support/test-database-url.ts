const DEFAULT_TEST_DATABASE_NAME = "kaneo_v2_test";

/** Integration tests truncate every table, so only `*_test` databases qualify. */
export function assertTestDatabaseName(name: string): void {
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against non-test database "${name}".`,
    );
  }
}

/**
 * The test database on the server the configured connection string names.
 * `TEST_DATABASE_NAME` picks another one, so parallel runs (one per
 * developer or agent) do not truncate each other's rows mid-test.
 */
export function testDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${process.env.TEST_DATABASE_NAME || DEFAULT_TEST_DATABASE_NAME}`;
  assertTestDatabaseName(decodeURIComponent(url.pathname.slice(1)));
  return url.toString();
}
