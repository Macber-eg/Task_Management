/** A trimmed string, null for blank or null, undefined when not a string. */
export function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value === null ? null : undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Enough of a secret to recognise it: the ends of a long one, dots otherwise. */
export function maskValue(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";
}

/** An omitted secret keeps the stored one; null or blank clears it. */
export function normalizeSecretInput(
  inputValue: string | null | undefined,
  existingValue: string | null | undefined,
) {
  if (inputValue === undefined) {
    return normalizeOptionalString(existingValue ?? undefined);
  }

  return normalizeOptionalString(inputValue);
}
