/** Labels that carry a task field (`priority:` / `status:`), not a Kaneo label. */
export function isSystemLabelName(name: string): boolean {
  return name.startsWith("priority:") || name.startsWith("status:");
}
