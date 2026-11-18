import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";

const PROBE = new Date("2024-01-15T12:34:56.789Z");

/**
 * Proves at startup that a Date survives a round trip through a
 * `timestamp without time zone` value unshifted. A host or driver setting
 * that breaks this would silently corrupt every stored time.
 */
@Injectable()
export class UtcSelfTest implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const [row] = (await this.dataSource.query(
      `select $1::timestamp as echoed,
              ($1::timestamp)::text as stored,
              current_setting('TimeZone') as zone`,
      [PROBE],
    )) as { echoed: Date; stored: string; zone: string }[];

    const stored = row?.stored ?? "";
    const echoed = row?.echoed instanceof Date ? row.echoed.getTime() : NaN;
    if (
      !stored.startsWith("2024-01-15 12:34:56.789") ||
      echoed !== PROBE.getTime()
    ) {
      throw new Error(
        `Timestamps are not handled as UTC (stored "${stored}", read back ${String(row?.echoed)}, session zone ${row?.zone}). Refusing to start.`,
      );
    }
  }
}
