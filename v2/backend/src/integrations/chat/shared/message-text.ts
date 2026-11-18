/** `in-progress` → `In Progress`; a missing value reads `Unknown`. */
export function toSentenceCase(value: string | null): string {
  if (!value) return "Unknown";
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

/** The `&`, `<`, `>` escaping Slack, Mattermost and Telegram HTML expect. */
export function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The body of a `task.description_changed` message. */
export function descriptionChangedBody(newDescription: string | null): string {
  return `The task description was updated${newDescription ? `: ${truncate(newDescription.replace(/\s+/g, " "), 160)}` : "."}`;
}

/** The body of a `comment.created` message. */
export function commentBody(comment: string): string {
  return truncate(comment.replace(/\s+/g, " "), 200);
}
