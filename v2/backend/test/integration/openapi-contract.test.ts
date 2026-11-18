import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../support/test-app";

const CONTRACT_PATH = join(__dirname, "../../contract/openapi.json");
const COMMITTED_SERVER = "https://cloud.kaneo.app/api";

// `contract/openapi.json` is the published API description. A route change
// that alters it must update that file in the same change, on purpose:
// regenerate it from `GET /api/openapi` with KANEO_API_URL unset.
describe("API integration: OpenAPI contract", () => {
  let app: TestApp;
  const previousApiUrl = process.env.KANEO_API_URL;

  beforeAll(async () => {
    delete process.env.KANEO_API_URL;
    app = await createTestApp();
  });

  afterAll(async () => {
    if (previousApiUrl === undefined) delete process.env.KANEO_API_URL;
    else process.env.KANEO_API_URL = previousApiUrl;
    await app.close();
  });

  it("matches the committed contract", async () => {
    const response = await app.request("/api/openapi");
    expect(response.status).toBe(200);
    const generated = (await response.json()) as {
      servers: { url: string }[];
    };
    expect(generated.servers[0]?.url).toBe(COMMITTED_SERVER);

    const committed: unknown = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
    expect(generated).toEqual(committed);
  });
});
