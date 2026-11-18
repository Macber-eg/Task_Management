import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { deleteReturning, updateReturning } from "../../database/dml";
import { DeviceCodeEntity } from "../../database/entities/device-code.entity";
import { UserEntity } from "../../database/entities/user.entity";
import { SessionEligibilityService } from "../sign-in-policy/session-eligibility.service";
import { isAllowedDeviceClient } from "./device-client-ids";
import { DEVICE_MESSAGES, deviceError } from "./device-error";
import { DeviceSessionService } from "./device-session.service";

export type DeviceTokenRequest = {
  grant_type: string;
  device_code: string;
  client_id: string;
};

/**
 * `POST /device/token`: the polling client exchanges its device code once
 * the person approved it (RFC 8628 section 3.4).
 */
@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eligibility: SessionEligibilityService,
    private readonly deviceSessions: DeviceSessionService,
  ) {}

  async exchange(
    body: DeviceTokenRequest,
    meta: { ipAddress: string | null; userAgent: string | null },
  ) {
    if (!isAllowedDeviceClient(body.client_id)) {
      throw deviceError(400, "invalid_grant", "Invalid client ID");
    }
    const manager = this.dataSource.manager;
    const record = await manager.findOne(DeviceCodeEntity, {
      where: { deviceCode: body.device_code },
    });
    if (!record) {
      throw deviceError(400, "invalid_grant", DEVICE_MESSAGES.INVALID_DEVICE_CODE);
    }
    if (record.clientId && record.clientId !== body.client_id) {
      throw deviceError(400, "invalid_grant", "Client ID mismatch");
    }

    const now = new Date();
    if (
      record.lastPolledAt &&
      record.pollingInterval &&
      now.getTime() - record.lastPolledAt.getTime() < record.pollingInterval
    ) {
      throw deviceError(400, "slow_down", DEVICE_MESSAGES.POLLING_TOO_FREQUENTLY);
    }
    await updateReturning(
      manager,
      DeviceCodeEntity,
      { lastPolledAt: now },
      { id: record.id },
    );

    if (record.expiresAt < now) {
      await manager.delete(DeviceCodeEntity, { id: record.id });
      throw deviceError(400, "expired_token", DEVICE_MESSAGES.EXPIRED_DEVICE_CODE);
    }
    if (record.status === "pending") {
      throw deviceError(
        400,
        "authorization_pending",
        DEVICE_MESSAGES.AUTHORIZATION_PENDING,
      );
    }
    if (record.status === "denied") {
      await manager.delete(DeviceCodeEntity, { id: record.id });
      throw deviceError(400, "access_denied", DEVICE_MESSAGES.ACCESS_DENIED);
    }
    if (record.status !== "approved" || !record.userId) {
      throw deviceError(500, "server_error", "Invalid device code status");
    }
    return this.issue(body.device_code, meta);
  }

  private async issue(
    deviceCode: string,
    meta: { ipAddress: string | null; userAgent: string | null },
  ) {
    const manager = this.dataSource.manager;
    // Deleting the approved code is what spends it: of two concurrent
    // polls, only one gets the row back and a token.
    const [claimed] = await deleteReturning(manager, DeviceCodeEntity, {
      deviceCode,
      status: "approved",
    });
    if (!claimed?.userId) {
      throw deviceError(400, "invalid_grant", DEVICE_MESSAGES.INVALID_DEVICE_CODE);
    }
    const user = await manager.findOne(UserEntity, {
      where: { id: claimed.userId },
    });
    if (!user) {
      throw deviceError(500, "server_error", DEVICE_MESSAGES.USER_NOT_FOUND);
    }

    const eligible = await this.eligibility.assertNotBanned(user);
    const created = await this.deviceSessions.create(eligible, meta);
    if (!created) {
      throw deviceError(500, "server_error", "Failed to create session");
    }
    return {
      access_token: created.token,
      token_type: "Bearer",
      expires_in: Math.floor(
        (created.session.expiresAt.getTime() - Date.now()) / 1000,
      ),
      scope: claimed.scope || "",
    };
  }
}
