import type { AddressInfo } from "node:net";
import type { Abstract, Type } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { DataSource, type EntityManager } from "typeorm";
import { AppModule } from "../../src/app.module";
import { Authenticator } from "../../src/auth/authenticator";
import { ApiExpressAdapter } from "../../src/common/http/api-express-adapter";
import { configureApp } from "../../src/configure-app";
import { TestAuthenticator } from "./test-authenticator";

type ProviderToken<T = unknown> = Type<T> | Abstract<T>;

export type ProviderOverride = [token: ProviderToken, value: unknown];

export type TestApp = {
  /** Like the previous tests' `app.request`: a path under the test server. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Resolves a provider from the running application. */
  get<T>(token: ProviderToken<T>): T;
  auth: TestAuthenticator;
  dataSource: DataSource;
  /** Shorthand for `dataSource.manager`, what the fixtures take. */
  db: EntityManager;
  close(): Promise<void>;
};

/**
 * Boots the real `AppModule` behind the middleware the server uses, on an
 * ephemeral port. The authenticator is replaced unless `realAuth` is set,
 * plus whatever the test overrides (integration seams).
 */
export async function createTestApp(
  options: {
    auth?: TestAuthenticator;
    overrides?: ProviderOverride[];
    /** Keep the real request authenticator (cookies, tokens, API keys). */
    realAuth?: boolean;
  } = {},
): Promise<TestApp> {
  const auth = options.auth ?? new TestAuthenticator();

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.realAuth) {
    builder = builder.overrideProvider(Authenticator).useValue(auth);
  }
  for (const [token, value] of options.overrides ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ApiExpressAdapter(),
    { bodyParser: false, logger: ["error", "warn"] },
  );
  configureApp(app);
  await app.listen(0, "127.0.0.1");

  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataSource = app.get(DataSource);

  return {
    request: (path, init) => fetch(`${baseUrl}${path}`, init),
    get: (token) => app.get(token, { strict: false }),
    auth,
    dataSource,
    db: dataSource.manager,
    close: () => app.close(),
  };
}
