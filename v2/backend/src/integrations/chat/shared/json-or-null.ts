import { reply } from "../../../common/http/reply";

/** Nest sends an empty body for `null`; these routes answer the JSON literal. */
export async function jsonOrNull<T>(value: Promise<T | null>) {
  return (await value) ?? reply(200, null);
}
