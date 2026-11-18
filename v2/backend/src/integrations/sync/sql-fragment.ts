import type { EntityManager } from "typeorm";

type Part = string | { value: unknown };

/**
 * A composable piece of SQL with bound values. Rule predicates are built once
 * and embedded in several statements, so placeholders are numbered only when
 * the final statement is rendered.
 */
export class SqlFragment {
  constructor(readonly parts: readonly Part[]) {}

  render(): { text: string; values: unknown[] } {
    const values: unknown[] = [];
    let text = "";
    for (const part of this.parts) {
      if (typeof part === "string") text += part;
      else {
        values.push(part.value);
        text += `$${values.length}`;
      }
    }
    return { text, values };
  }
}

/** Interpolated values are bound parameters; interpolated fragments are inlined. */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlFragment {
  const parts: Part[] = [];
  strings.forEach((text, index) => {
    parts.push(text);
    if (index >= values.length) return;
    const value = values[index];
    if (value instanceof SqlFragment) parts.push(...value.parts);
    else parts.push({ value });
  });
  return new SqlFragment(parts);
}

/** Trusted SQL text, never user input. */
export function rawSql(text: string): SqlFragment {
  return new SqlFragment([text]);
}

export function joinSql(
  fragments: readonly SqlFragment[],
  separator: string,
): SqlFragment {
  const parts: Part[] = [];
  fragments.forEach((fragment, index) => {
    if (index) parts.push(separator);
    parts.push(...fragment.parts);
  });
  return new SqlFragment(parts);
}

export async function runSql<T>(
  db: EntityManager,
  fragment: SqlFragment,
): Promise<T[]> {
  const { text, values } = fragment.render();
  return (await db.query(text, values)) as T[];
}
