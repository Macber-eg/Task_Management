import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserAvatarEntity } from "../../src/database/entities/user-avatar.entity";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("API integration: avatar routes", () => {
  let app: TestApp;

  function upload(contentType: string, data: Buffer) {
    return app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType, data: data.toString("base64") }),
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("stores an uploaded avatar and serves it back without authentication", async () => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(member.user);

    const png = Buffer.concat([PNG, Buffer.from([0x01, 0x02])]);

    const uploadResponse = await upload("image/png", png);

    expect(uploadResponse.status).toBe(200);
    const avatar = (await uploadResponse.json()) as {
      id: string;
      url: string;
      size: number;
    };
    expect(avatar.url).toBe(`/api/user/avatar/${avatar.id}`);
    expect(avatar.size).toBe(png.length);

    app.auth.signOut();
    const downloadResponse = await app.request(avatar.url);

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("image/png");
    expect(downloadResponse.headers.get("content-length")).toBe(
      String(png.length),
    );
    expect(downloadResponse.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(downloadResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(downloadResponse.headers.get("etag")).toBe(`"${avatar.id}"`);
    expect(Buffer.from(await downloadResponse.arrayBuffer())).toEqual(png);
  });

  it("answers 304 only to the avatar's own ETag", async () => {
    const member = await createWorkspaceMember(app.db);
    app.auth.signIn(member.user);
    const avatar = (await (await upload("image/png", PNG)).json()) as {
      id: string;
      url: string;
    };
    app.auth.signOut();

    const fresh = await app.request(avatar.url, {
      headers: { "If-None-Match": `"${avatar.id}"` },
    });
    const stale = await app.request(avatar.url, {
      headers: {
        "If-None-Match": '"another-avatar"',
        "If-Modified-Since": new Date(Date.now() + 60_000).toUTCString(),
      },
    });

    expect(fresh.status).toBe(304);
    expect(fresh.headers.get("etag")).toBe(`"${avatar.id}"`);
    expect(await fresh.text()).toBe("");
    expect(stale.status).toBe(200);
  });

  it("answers 404 for an unknown avatar", async () => {
    app.auth.signOut();

    const response = await app.request("/api/user/avatar/missing");

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toEqual({
      message: "Avatar not found",
      code: "NOT_FOUND",
    });
  });

  it("rejects bytes that do not match the declared image type", async () => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(member.user);

    const response = await upload("image/png", Buffer.from("<html></html>"));

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toEqual({
      message: "Image data does not match the declared image/png type.",
      code: "BAD_REQUEST",
    });
  });

  it("replaces the previous avatar and retires its URL", async () => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(member.user);

    const first = (await (await upload("image/png", PNG)).json()) as {
      id: string;
      url: string;
    };

    const second = (await (
      await upload("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x01]))
    ).json()) as { id: string; url: string };

    expect(second.id).not.toBe(first.id);
    expect((await app.request(first.url)).status).toBe(404);
    expect((await app.request(second.url)).status).toBe(200);

    const rows = await app.db.find(UserAvatarEntity, {
      where: { userId: member.user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: second.id, mimeType: "image/jpeg" });
  });

  it("deletes the avatar of the current user", async () => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(member.user);

    await upload("image/png", PNG);

    const response = await app.request("/api/user/avatar", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });

    const rows = await app.db.find(UserAvatarEntity, {
      where: { userId: member.user.id },
    });
    expect(rows).toHaveLength(0);

    const again = await app.request("/api/user/avatar", { method: "DELETE" });
    await expect(again.json()).resolves.toEqual({ deleted: false });
  });

  it("requires authentication to upload an avatar", async () => {
    app.auth.signOut();

    const response = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", data: "" }),
    });

    expect(response.status).toBe(401);
  });
});
