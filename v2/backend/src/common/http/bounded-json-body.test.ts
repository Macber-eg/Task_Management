import { PassThrough } from "node:stream";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedJsonBody } from "./bounded-json-body";

function upload(headers: Record<string, string>) {
  const stream = new PassThrough();
  const request = Object.assign(stream, {
    headers,
    is: (type: string) => headers["content-type"] === type,
  }) as unknown as Request & PassThrough;
  return request;
}

function run(request: Request, maxBytes: number, timeoutMs?: number) {
  const next = vi.fn();
  boundedJsonBody(maxBytes, timeoutMs)(request, {} as Response, next);
  return next;
}

const json = { "content-type": "application/json" };

describe("boundedJsonBody", () => {
  afterEach(() => vi.useRealTimers());

  it("passes a request without a body straight through", () => {
    const next = run(upload({}), 8);

    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it("parses a JSON body within the bound", async () => {
    const request = upload({ ...json, "content-length": "7" });
    const next = run(request, 8);

    request.end('{"a":1}');
    await vi.waitFor(() => expect(next).toHaveBeenCalledExactlyOnceWith());

    expect(request.body).toEqual({ a: 1 });
  });

  it("leaves a body of another type unparsed", async () => {
    const request = upload({
      "content-type": "text/plain",
      "content-length": "5",
    });
    const next = run(request, 8);

    request.end("hello");
    await vi.waitFor(() => expect(next).toHaveBeenCalledExactlyOnceWith());

    expect(request.body).toBeUndefined();
  });

  it("refuses a declared length over the bound without waiting for bytes", () => {
    const next = run(upload({ ...json, "content-length": "9" }), 8);

    expect(next).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 413,
        message: "Request body is too large",
      }),
    );
  });

  it("counts the bytes of a chunked body", async () => {
    const request = upload({ ...json, "transfer-encoding": "chunked" });
    const next = run(request, 8);

    request.write("12345");
    request.write("6789");
    await vi.waitFor(() =>
      expect(next).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 413 }),
      ),
    );
  });

  it("answers malformed JSON with the global parser's error", async () => {
    const request = upload({ ...json, "content-length": "5" });
    const next = run(request, 8);

    request.end("{oops");
    await vi.waitFor(() =>
      expect(next).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          status: 400,
          message: "Malformed JSON in request body",
        }),
      ),
    );
  });

  it("gives up on a body that is not sent in time, then drops the upload", () => {
    vi.useFakeTimers();
    const request = upload({ ...json, "transfer-encoding": "chunked" });
    const next = run(request, 8, 5_000);

    request.write("{");
    vi.advanceTimersByTime(4_999);
    expect(next).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 408,
        message: "Request body timed out",
      }),
    );
    expect(request.destroyed).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(request.destroyed).toBe(true);
  });
});
