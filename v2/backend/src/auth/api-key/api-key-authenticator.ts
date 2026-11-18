import type { Request } from "express";
import type { Principal } from "../principal";

/**
 * Turns an API key into a caller.
 *
 * Returns null when the value is not a usable key at all (unknown, disabled,
 * expired, owner banned). Throws an `HTTPException` for a key that exists but
 * is refused with its own response, such as a rate-limited or exhausted one.
 * `consume: false` checks the key without spending quota.
 */
export abstract class ApiKeyAuthenticator {
  abstract authenticate(
    key: string,
    options: { consume: boolean },
    request: Request,
  ): Promise<Principal | null>;
}
