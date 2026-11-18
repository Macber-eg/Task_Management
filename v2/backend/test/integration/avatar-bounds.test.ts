import { type ClientRequest, request as httpRequest } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserAvatarEntity } from "../../src/database/entities/user-avatar.entity";
import {
  MAX_AVATAR_BYTES,
  MAX_AVATAR_INPUT_CHARS,
  MAX_AVATAR_REQUEST_BYTES,
} from "../../src/user/avatar";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("avatar request bounds", () => {
  let app: TestApp;
  let port: number;

  /**
   * Opens a PUT to the avatar route and resolves with the status as soon as
   * the server answers, while `send` may still be writing the body.
   */
  function openUpload(
    headers: Record<string, string>,
    send: (upload: ClientRequest) => void = () => {},
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const upload = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/api/user/avatar",
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
      });
      upload.once("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        upload.destroy();
      });
      upload.on("error", reject);
      upload.flushHeaders();
      send(upload);
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    port = Number(new URL((await app.request("/api/health")).url).port);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    const member = await createWorkspaceMember(app.db, { role: "viewer" });
    app.auth.signIn(member.user);
  });

  it("rejects excessive declared length before reading the body", async () => {
    // No body byte is ever sent, so an answer proves none was waited for.
    const status = await openUpload({
      "content-length": String(MAX_AVATAR_REQUEST_BYTES + 1),
    });

    expect(status).toBe(413);
    expect(await app.db.find(UserAvatarEntity)).toHaveLength(0);
  });

  it("counts actual chunked bytes before JSON parsing", async () => {
    const status = await openUpload(
      { "transfer-encoding": "chunked" },
      (upload) => {
        const chunk = Buffer.alloc(16 * 1024);
        const pump = () => {
          if (upload.destroyed) return;
          if (upload.write(chunk)) setImmediate(pump);
          else upload.once("drain", pump);
        };
        pump();
      },
    );

    // Invalid JSON would be 400 if the parser ran before the byte guard.
    expect(status).toBe(413);
    expect(await app.db.find(UserAvatarEntity)).toHaveLength(0);
  });

  it("rejects oversized encoded input inside a bounded JSON request", async () => {
    const response = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: "image/png",
        data: " ".repeat(MAX_AVATAR_INPUT_CHARS + 1),
      }),
    });

    expect(response.status).toBe(400);
    expect(await app.db.find(UserAvatarEntity)).toHaveLength(0);
  });

  it("answers malformed JSON as the global parser does", async () => {
    const response = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Malformed JSON in request body",
      code: "BAD_REQUEST",
    });
  });

  it("stores a valid maximum-size avatar for an authenticated viewer", async () => {
    const bytes = Buffer.alloc(MAX_AVATAR_BYTES);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);

    const response = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: "image/png",
        data: bytes.toString("base64"),
      }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const [row] = await app.db.find(UserAvatarEntity);
    expect(row?.size).toBe(MAX_AVATAR_BYTES);
    expect(row?.data.equals(bytes)).toBe(true);
  });
});
