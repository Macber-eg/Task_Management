import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { DeviceCodeEntity } from "../../database/entities/device-code.entity";
import { isAllowedDeviceClient } from "./device-client-ids";
import { generateDeviceCode, generateUserCode } from "./device-codes";
import { deviceError } from "./device-error";
import { deviceVerificationUris } from "./device-verification-uri";

const CODE_TTL_MS = 30 * 60 * 1000;
const POLLING_INTERVAL_MS = 5000;

export type DeviceCodeRequest = {
  client_id: string;
  user_id?: string;
  scope?: string;
};

/** `POST /device/code`: starts a device login (RFC 8628 section 3.2). */
@Injectable()
export class DeviceCodeService {
  constructor(private readonly dataSource: DataSource) {}

  async request(body: DeviceCodeRequest) {
    if (!isAllowedDeviceClient(body.client_id)) {
      throw deviceError(400, "invalid_client", "Invalid client ID");
    }

    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    await insertReturning(this.dataSource.manager, DeviceCodeEntity, {
      deviceCode,
      userCode,
      userId: body.user_id || null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      status: "pending",
      pollingInterval: POLLING_INTERVAL_MS,
      clientId: body.client_id,
      scope: body.scope ?? null,
    });

    const uris = deviceVerificationUris(userCode);
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: uris.verificationUri,
      verification_uri_complete: uris.verificationUriComplete,
      expires_in: Math.floor(CODE_TTL_MS / 1000),
      interval: Math.floor(POLLING_INTERVAL_MS / 1000),
    };
  }
}
