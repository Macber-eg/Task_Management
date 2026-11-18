import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { recordApiKeyHeaders } from "./api-key-headers";
import { applyApiKeyHeaders } from "./apply-api-key-headers";

type Respond = (response: express.Response) => void;

async function request(
  apiKeyHeaders: Record<string, string> | undefined,
  respond: Respond,
): Promise<Response> {
  const app = express();
  app.use(applyApiKeyHeaders);
  app.get("/", (req, res) => {
    if (apiKeyHeaders) recordApiKeyHeaders(req, apiKeyHeaders);
    respond(res);
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/`);
  } finally {
    server.close();
  }
}

function withCacheControl(cacheControl: string | null): Respond {
  return (response) => {
    if (cacheControl) response.setHeader("Cache-Control", cacheControl);
    response.send("asset");
  };
}

const limitHeaders = {
  "X-RateLimit-Limit": "100",
  "X-RateLimit-Remaining": "99",
  "X-RateLimit-Reset": "1767225660",
};

describe("applyApiKeyHeaders", () => {
  it("adds the key's headers to the response", async () => {
    const response = await request(limitHeaders, withCacheControl("no-store"));

    expect(response.headers.get("x-ratelimit-remaining")).toBe("99");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    [null, "private"],
    ["public, max-age=300", "private, max-age=300"],
    ["max-age=60", "private, max-age=60"],
    ["private, max-age=60", "private, max-age=60"],
    ["no-store", "no-store"],
  ])(
    "keeps per-key headers out of shared caches when Cache-Control is %s",
    async (cacheControl, expected) => {
      const response = await request(
        limitHeaders,
        withCacheControl(cacheControl),
      );

      expect(response.headers.get("x-ratelimit-limit")).toBe("100");
      expect(response.headers.get("cache-control")).toBe(expected);
    },
  );

  it("marks a Retry-After-only response private", async () => {
    const response = await request(
      { "Retry-After": "42" },
      withCacheControl(null),
    );

    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("private");
  });

  it("leaves responses without key headers untouched", async () => {
    for (const cacheControl of ["public, max-age=300", null]) {
      for (const headers of [undefined, {}]) {
        const response = await request(headers, withCacheControl(cacheControl));

        expect(response.headers.get("cache-control")).toBe(cacheControl);
        expect(response.headers.get("x-ratelimit-limit")).toBeNull();
      }
    }
  });

  it.each([
    ["an object", { "Cache-Control": "public, max-age=300", "X-Kind": "a" }],
    ["a raw list", ["Cache-Control", "public, max-age=300", "X-Kind", "a"]],
  ])(
    "still applies when the handler passes headers to writeHead as %s",
    async (_, headers) => {
      const response = await request(limitHeaders, (res) => {
        res.setHeader("X-Kind", "replaced");
        res.writeHead(202, headers).end("streamed");
      });

      expect(response.status).toBe(202);
      expect(response.headers.get("x-kind")).toBe("a");
      expect(response.headers.get("x-ratelimit-limit")).toBe("100");
      expect(response.headers.get("cache-control")).toBe(
        "private, max-age=300",
      );
      expect(await response.text()).toBe("streamed");
    },
  );
});
