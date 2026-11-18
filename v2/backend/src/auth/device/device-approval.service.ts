import { Injectable } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { updateReturning } from "../../database/dml";
import { DeviceCodeEntity } from "../../database/entities/device-code.entity";
import { normalizeUserCode } from "./device-codes";
import { DEVICE_MESSAGES, deviceError } from "./device-error";

export type DeviceDecision = "approved" | "denied";

/**
 * The signed-in side of a device login. Opening the code first claims it for
 * the person viewing it; only that person may then approve or deny it, so a
 * code read over someone's shoulder cannot be approved by another account.
 */
@Injectable()
export class DeviceApprovalService {
  constructor(private readonly dataSource: DataSource) {}

  /** `GET /device`: the code's status, claiming a pending code for `userId`. */
  async view(userCode: string, userId: string | null) {
    const record = await this.findLive(userCode);
    if (userId && !record.userId && record.status === "pending") {
      await updateReturning(
        this.dataSource.manager,
        DeviceCodeEntity,
        { userId },
        { id: record.id, status: "pending", userId: IsNull() },
      );
    }
    return { user_code: userCode, status: record.status };
  }

  /** `POST /device/approve` and `/device/deny`. */
  async decide(
    userCode: string,
    userId: string,
    decision: DeviceDecision,
  ): Promise<{ success: true }> {
    const record = await this.findLive(userCode);
    if (record.status !== "pending") {
      throw deviceError(
        400,
        "invalid_request",
        DEVICE_MESSAGES.DEVICE_CODE_ALREADY_PROCESSED,
      );
    }
    if (!record.userId) {
      throw deviceError(400, "invalid_request", DEVICE_MESSAGES.DEVICE_CODE_NOT_CLAIMED);
    }
    if (record.userId !== userId) {
      const verb = decision === "approved" ? "approve" : "deny";
      throw deviceError(
        403,
        "access_denied",
        `You are not authorized to ${verb} this device authorization`,
      );
    }
    await updateReturning(
      this.dataSource.manager,
      DeviceCodeEntity,
      { status: decision, userId },
      { id: record.id },
    );
    return { success: true };
  }

  private async findLive(userCode: string): Promise<DeviceCodeEntity> {
    const record = await this.dataSource.manager.findOne(DeviceCodeEntity, {
      where: { userCode: normalizeUserCode(userCode) },
    });
    if (!record) {
      throw deviceError(400, "invalid_request", DEVICE_MESSAGES.INVALID_USER_CODE);
    }
    if (record.expiresAt < new Date()) {
      throw deviceError(400, "expired_token", DEVICE_MESSAGES.EXPIRED_USER_CODE);
    }
    return record;
  }
}
