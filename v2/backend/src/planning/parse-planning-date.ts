import { HTTPException } from "../common/errors/http-exception";

/** Null for an empty value; 400 naming `field` when it is not a date. */
export function parsePlanningDate(
  value: string | null | undefined,
  field: string,
): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HTTPException(400, { message: `Invalid ${field}` });
  }
  return date;
}
