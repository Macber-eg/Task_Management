import { describe, expect, it, vi } from "vitest";
import type { ApiRequest } from "../auth/principal";
import type { UserEntity } from "../database/entities/user.entity";
import { Access } from "./access-rule";
import { InstanceAdminHandler } from "./instance-admin.handler";
import { requireInstanceAdmin } from "./require-instance-admin";
import { requireUserSession } from "./require-user-session";
import { UserSessionHandler } from "./user-session.handler";
import { WorkspacePermissionService } from "./workspace-permission.service";

function handlerWithStoredRole(role: string | null) {
  const query = vi.fn().mockResolvedValue([{ role }]);
  const permissions = new WorkspacePermissionService({ query } as never);
  return { handler: new InstanceAdminHandler(permissions), query };
}

function requestFor(user: Partial<UserEntity> | null) {
  return {
    principal: {
      userId: "user-1",
      userEmail: "",
      user,
      session: null,
    },
  } as ApiRequest;
}

const refusal = {
  status: 403,
  message: "Instance administrator access is required",
};

describe("InstanceAdminHandler", () => {
  it("accepts a session whose user is an instance admin", async () => {
    const { handler, query } = handlerWithStoredRole(null);

    await expect(
      handler.check(requestFor({ role: "user,admin" })),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a session whose user is not", async () => {
    const { handler } = handlerWithStoredRole("admin");

    await expect(
      handler.check(requestFor({ role: "user" })),
    ).rejects.toMatchObject(refusal);
  });

  it("reads the role from the database for an API key", async () => {
    const admin = handlerWithStoredRole("admin");
    await expect(
      admin.handler.check(requestFor(null)),
    ).resolves.toBeUndefined();
    expect(admin.query).toHaveBeenCalledOnce();

    const member = handlerWithStoredRole(null);
    await expect(member.handler.check(requestFor(null))).rejects.toMatchObject(
      refusal,
    );
  });

  it("is the rule requireInstanceAdmin() declares, after requireUserSession()", () => {
    expect(requireInstanceAdmin()).toEqual({
      handler: InstanceAdminHandler,
      options: undefined,
    });
    expect(requireUserSession()).toEqual({
      handler: UserSessionHandler,
      options: undefined,
    });
    // The pair the admin routes declare must satisfy the decorator's types.
    expect(Access(requireUserSession(), requireInstanceAdmin())).toBeTypeOf(
      "function",
    );
  });

  it("refuses a request without a caller", async () => {
    const { handler } = handlerWithStoredRole("admin");

    await expect(handler.check({} as ApiRequest)).rejects.toMatchObject(
      refusal,
    );
  });
});
