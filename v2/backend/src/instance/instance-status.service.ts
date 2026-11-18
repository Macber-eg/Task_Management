import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { instanceAdminRoleSql } from "../access/instance-admin-role";
import { hasRegisteredUsers } from "./has-registered-users";

export type InstanceStatus = {
  hasUsers: boolean;
  hasAdmin: boolean;
};

@Injectable()
export class InstanceStatusService {
  constructor(private readonly dataSource: DataSource) {}

  async getInstanceStatus(): Promise<InstanceStatus> {
    const manager = this.dataSource.manager;
    const hasUsers = await hasRegisteredUsers(manager);
    const admins = (await manager.query(
      `SELECT 1 FROM "user" WHERE ${instanceAdminRoleSql("role")} LIMIT 1`,
    )) as unknown[];

    return { hasUsers, hasAdmin: admins.length > 0 };
  }
}
