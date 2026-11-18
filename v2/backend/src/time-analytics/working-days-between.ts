/** Monday-to-Friday days from `from` to `to`, both inclusive, in server time. */
export function workingDaysBetween(from: Date, to: Date): number {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  if (end < start) return 0;
  let days = 0;
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}
