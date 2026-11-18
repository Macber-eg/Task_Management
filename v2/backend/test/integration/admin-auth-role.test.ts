import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AdminUserUpdateService } from "../../src/admin/auth-admin/admin-user-update.service";
import { UserEntity } from "../../src/database/entities/user.entity";
import { type Browser, signUpBrowser } from "../support/browser";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe.each(["/admin/set-role", "/admin/update-user"])(
  "API integration: %s",
  (path) => {
    let app: TestApp;

    type Account = { id: string; browser: Browser; token: string };

    async function createAccount(role: string): Promise<Account> {
      const browser = await signUpBrowser(app, `${randomUUID()}@example.com`);
      await app.db.update(UserEntity, { id: browser.userId }, { role });
      return {
        id: browser.userId,
        browser,
        token: browser.jar.get("kaneo.access_token") ?? "",
      };
    }

    function body(userId: string, role: string | string[]) {
      return path === "/admin/set-role"
        ? { userId, role }
        : { userId, data: { role } };
    }

    function request(
      as: Account | null,
      payload: unknown,
      headers: Record<string, string> = {},
    ) {
      if (as && !headers.authorization) {
        return as.browser.post(`/api/auth${path}`, payload);
      }
      return app.request(`/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    }

    async function getRole(id: string) {
      return (await app.db.findOneByOrFail(UserEntity, { id })).role;
    }

    beforeAll(async () => {
      app = await createTestApp({ realAuth: true });
    });

    beforeEach(async () => {
      await resetTestDatabase(app.dataSource);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      await app.close();
    });

    it.each([
      { role: "user" },
      { role: ["user"] },
      { role: [] },
      { role: "admin" },
    ])("rejects setting your own role to $role", async ({ role }) => {
      const admin = await createAccount("admin");
      const response = await request(admin, body(admin.id, role));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
      });
      expect(await getRole(admin.id)).toBe("admin");
    });

    it("rejects changing your own role using a bearer token", async () => {
      const admin = await createAccount("admin");
      const response = await request(null, body(admin.id, "user"), {
        authorization: `Bearer ${admin.token}`,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
      });
      expect(await getRole(admin.id)).toBe("admin");
    });

    it("allows managing another user but preserves the remaining admin", async () => {
      const admin = await createAccount("admin");
      const other = await createAccount("user");

      expect((await request(admin, body(other.id, "admin"))).status).toBe(200);
      expect(await getRole(other.id)).toBe("admin");
      expect((await request(admin, body(admin.id, "user"))).status).toBe(400);
      expect((await request(admin, body(other.id, "user"))).status).toBe(200);
      expect((await request(admin, body(admin.id, "user"))).status).toBe(400);
      expect(await getRole(admin.id)).toBe("admin");
      expect(await getRole(other.id)).toBe("user");
    });

    it("counts an admin stored as a role list as remaining", async () => {
      const admin = await createAccount("admin");
      const listed = await createAccount("user,admin");

      expect((await request(admin, body(listed.id, "user"))).status).toBe(200);
      expect(await getRole(listed.id)).toBe("user");
      expect((await request(admin, body(admin.id, "user"))).status).toBe(400);
      expect(await getRole(admin.id)).toBe("admin");
    });

    it("denies a demoted admin even with their old session cookie", async () => {
      const admin = await createAccount("admin");
      const other = await createAccount("admin");
      expect((await request(admin, body(other.id, "user"))).status).toBe(200);

      const response = await request(other, body(admin.id, "user"));
      expect(response.status).toBe(403);
      expect(await getRole(admin.id)).toBe("admin");
    });

    it("requires authentication", async () => {
      const admin = await createAccount("admin");
      const response = await request(null, body(admin.id, "user"));
      expect(response.status).toBe(401);
      expect(await getRole(admin.id)).toBe("admin");
    });

    it("answers 404 for an unknown user", async () => {
      const admin = await createAccount("admin");
      const response = await request(admin, body("missing-user", "admin"));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "USER_NOT_FOUND" });
    });

    it("preserves an administrator when admins concurrently demote each other", async () => {
      const admin = await createAccount("admin");
      const other = await createAccount("admin");
      // Multiple roles must still count as an administrator.
      await app.db.update(UserEntity, { id: other.id }, { role: "user,admin" });

      const service = app.get(AdminUserUpdateService) as unknown as {
        write: (...args: unknown[]) => Promise<unknown>;
      };
      const write = service.write.bind(service);
      let release = () => {};
      const bothAuthorized = new Promise<void>((resolve) => {
        release = resolve;
      });
      let arrivals = 0;
      // Hold both writes until both requests have passed authorization.
      vi.spyOn(service, "write").mockImplementation(async (...args) => {
        if (++arrivals === 2) release();
        await bothAuthorized;
        return write(...args);
      });

      const responses = await Promise.all([
        request(admin, body(other.id, "user")),
        request(other, body(admin.id, "user")),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      const rejected = responses.find((response) => response.status === 400);
      expect(await rejected?.json()).toMatchObject({
        code: "CANNOT_REMOVE_LAST_ADMIN",
      });
      const roles = await Promise.all([getRole(admin.id), getRole(other.id)]);
      expect(
        roles.filter((role) => role?.split(",").includes("admin")),
      ).toHaveLength(1);
    });
  },
);
