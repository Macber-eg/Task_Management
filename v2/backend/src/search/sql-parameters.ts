/** Collects bind values for a raw statement and hands out `$n` placeholders. */
export class SqlParameters {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
