import pg from "pg";

const TIMESTAMP_WITHOUT_TIME_ZONE = 1114;

function parseUtcTimestamp(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

let configured = false;

/**
 * `timestamp without time zone` columns hold UTC (the schema's defaults are
 * `now() AT TIME ZONE 'utc'`). node-postgres would otherwise read and write
 * them in the process's local zone, shifting every value on a non-UTC host.
 */
export function configurePgUtc(): void {
  if (configured) return;
  configured = true;

  pg.defaults.parseInputDatesAsUTC = true;
  pg.types.setTypeParser(TIMESTAMP_WITHOUT_TIME_ZONE, parseUtcTimestamp);
}
