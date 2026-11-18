import { readFileSync } from "node:fs";

const cachedFileSecrets = new Map<string, string>();

/** Reads `NAME`, or the file named by `NAME_FILE` (Docker/Kubernetes secrets). */
export function resolveFileSecret(name: string): string | undefined {
  const directValue = process.env[name];
  if (directValue) return directValue;

  const fileVariable = `${name}_FILE`;
  const filePath = process.env[fileVariable];
  if (!filePath) return undefined;

  const cached = cachedFileSecrets.get(filePath);
  if (cached !== undefined) return cached;

  let value: string;
  try {
    value = readFileSync(filePath, "utf8").replace(/(?:\r?\n)+$/, "");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    throw new Error(
      `${fileVariable} could not be read (${code}): ${filePath}`,
      { cause: error },
    );
  }

  if (!value) {
    throw new Error(`${fileVariable} points to an empty file: ${filePath}`);
  }
  cachedFileSecrets.set(filePath, value);
  return value;
}
