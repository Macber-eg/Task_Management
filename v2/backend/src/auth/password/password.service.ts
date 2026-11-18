import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { authError } from "../auth-error";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Cost 10 matches the hashes already stored in `account.password`.
const BCRYPT_COST = 10;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_COST);
  }

  verify(hash: string, password: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  assertAcceptable(password: unknown): asserts password is string {
    if (!password || typeof password !== "string") {
      throw authError("INVALID_PASSWORD");
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw authError("PASSWORD_TOO_SHORT");
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw authError("PASSWORD_TOO_LONG");
    }
  }
}
