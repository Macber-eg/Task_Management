import { timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { OTP_EXPIRY_SECONDS } from "../../email/otp-expiry";
import { randomString } from "../api-key/random-string";
import { authError } from "../auth-error";
import { VerificationStore } from "../verification/verification-store.service";

const OTP_LENGTH = 6;
const ALLOWED_ATTEMPTS = 3;

export type OtpType = "email-verification" | "sign-in" | "forget-password";

export function otpIdentifier(type: OtpType, email: string): string {
  return `${type}-otp-${email}`;
}

function splitAtLastColon(input: string): [string, string] {
  const index = input.lastIndexOf(":");
  return index === -1
    ? [input, ""]
    : [input.slice(0, index), input.slice(index + 1)];
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * One-time email codes, stored as `<code>:<failed attempts>` in a
 * `verification` row. A code works once, survives two wrong guesses and
 * expires after `OTP_EXPIRY_SECONDS`.
 */
@Injectable()
export class OtpCodes {
  constructor(private readonly verifications: VerificationStore) {}

  async issue(type: OtpType, email: string): Promise<string> {
    const otp = randomString(OTP_LENGTH, "0123456789");
    await this.verifications.create(
      otpIdentifier(type, email),
      `${otp}:0`,
      new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000),
    );
    return otp;
  }

  discard(type: OtpType, email: string): Promise<void> {
    return this.verifications.deleteByIdentifier(otpIdentifier(type, email));
  }

  /** Redeems the code or throws; a wrong guess is counted against it. */
  async redeem(type: OtpType, email: string, otp: string): Promise<void> {
    const identifier = otpIdentifier(type, email);
    const existing = await this.verifications.findLatest(identifier);
    if (existing && existing.expiresAt < new Date()) {
      await this.verifications.deleteByIdentifier(identifier);
      throw authError("OTP_EXPIRED");
    }

    const consumed = await this.verifications.consume(identifier);
    if (!consumed) throw authError("INVALID_OTP");
    const [code, attempts] = splitAtLastColon(consumed.value);
    const usedAttempts = Number.parseInt(attempts || "0", 10);
    if (usedAttempts >= ALLOWED_ATTEMPTS) throw authError("TOO_MANY_ATTEMPTS");

    if (!sameCode(code, otp)) {
      await this.verifications.create(
        identifier,
        `${code}:${usedAttempts + 1}`,
        consumed.expiresAt,
      );
      throw authError("INVALID_OTP");
    }
  }
}
