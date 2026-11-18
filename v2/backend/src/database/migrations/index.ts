import { Baseline1793000000000 } from "./0001-baseline";
import { SessionJwt1793000000001 } from "./0002-session-jwt";

// Hand-written only. Never add a migration produced by `migration:generate`:
// entity metadata does not describe the triggers, partial indexes and
// composite foreign keys the schema relies on, so a generated diff would
// drop them.
export const MIGRATIONS = [
  Baseline1793000000000,
  SessionJwt1793000000001,
] as const;
