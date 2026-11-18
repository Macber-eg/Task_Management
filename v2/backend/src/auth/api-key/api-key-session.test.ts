import { describe, expect, it } from "vitest";
import type { UserEntity } from "../../database/entities/user.entity";
import { apiKeySessionOutput } from "./api-key-session";

const now = new Date("2026-03-01T12:00:00.000Z");
const user = {
  id: "user-1",
  name: "Key Owner",
  email: "owner@example.com",
} as UserEntity;

describe("apiKeySessionOutput", () => {
  it("builds the session from the key, carrying the key as its token", () => {
    const expiresAt = new Date("2026-04-01T00:00:00.000Z");

    const output = apiKeySessionOutput(
      {
        user,
        apiKey: { id: "key-1", expiresAt },
        key: "secret",
        ipAddress: "127.0.0.1",
        userAgent: "cli",
      },
      now,
    );

    expect(output.session).toEqual({
      id: "key-1",
      token: "secret",
      userId: "user-1",
      userAgent: "cli",
      ipAddress: "127.0.0.1",
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    expect(output.user).toMatchObject({ id: "user-1", name: "Key Owner" });
  });

  it("lasts a week when the key never expires", () => {
    const output = apiKeySessionOutput(
      {
        user,
        apiKey: { id: "key-1", expiresAt: null },
        key: "secret",
        ipAddress: null,
        userAgent: null,
      },
      now,
    );

    expect(output.session.expiresAt).toEqual(
      new Date("2026-03-08T12:00:00.000Z"),
    );
  });
});
