import type { Request } from "express";
import type { Principal } from "./principal";

/**
 * Resolves the caller from a request's credentials. Returns null when the
 * request carries none that are valid; throws only for rejections that need
 * their own status (for example a rate-limited API key).
 */
export abstract class Authenticator {
  abstract authenticate(request: Request): Promise<Principal | null>;
}
