const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

// Date.parse alone accepts impossible calendar dates like 2024-02-31, so the
// round-trip through UTC getters rejects anything the calendar rolled over.
export function isIsoTimestamp(value: string) {
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}
