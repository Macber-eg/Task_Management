import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, client } from "./client";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildRequest", () => {
  it("fills and encodes path parameters", () => {
    const [url, init] = buildRequest(["task", ":id"], "get", {
      param: { id: "a b/c" },
    });
    expect(url).toBe("http://api.test/api/task/a%20b%2Fc");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("serialises query values, repeating arrays and skipping empty ones", () => {
    const [url] = buildRequest(["search"], "get", {
      query: { q: "x", page: 2, tag: ["a", "b"], skip: undefined },
    });
    expect(url).toBe("http://api.test/api/search?q=x&page=2&tag=a&tag=b");
  });

  it("sends json bodies as text and forms as FormData", () => {
    const [, jsonInit] = buildRequest(["label"], "post", {
      json: { name: "bug" },
    });
    expect(jsonInit.body).toBe('{"name":"bug"}');

    const file = new Blob(["x"]);
    const [, formInit] = buildRequest(["upload"], "post", {
      form: { file, surface: "comment" },
    });
    expect(formInit.body).toBeInstanceOf(FormData);
    expect((formInit.body as FormData).get("surface")).toBe("comment");
  });

  it("merges init and header options", () => {
    const signal = new AbortController().signal;
    const [, init] = buildRequest(["task"], "get", undefined, {
      init: { signal },
      headers: { "X-Test": "1" },
    });
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get("X-Test")).toBe("1");
  });

  it("rejects a missing path parameter", () => {
    expect(() => buildRequest(["task", ":id"], "get", {})).toThrow(
      'Missing path parameter "id"',
    );
  });
});

describe("client", () => {
  it("calls the API through the proxy path", async () => {
    await client.task[":id"].$get({ param: { id: "t1" } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/api/task/t1");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("is not thenable", () => {
    expect((client as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
