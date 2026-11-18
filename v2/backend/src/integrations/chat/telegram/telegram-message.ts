import { createHash } from "node:crypto";
import { escapeMarkup, toSentenceCase } from "../shared/message-text";
import type { TelegramConfig } from "./telegram-config";

export type TelegramEventData = {
  taskTitle: string;
  taskNumber: number | null;
  projectName: string;
  taskUrl: string | null;
  actorName: string | null;
  status: string | null;
  priority: string | null;
};

/** Telegram has no default client URL: without one the task is not linked. */
export function telegramTaskUrl(
  clientUrl: string | undefined,
  workspaceId: string,
  projectId: string,
  taskId: string,
): string | null {
  const normalizedClientUrl = clientUrl?.trim();
  if (!normalizedClientUrl) {
    return null;
  }

  try {
    return new URL(
      `/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`,
      normalizedClientUrl,
    ).toString();
  } catch {
    return null;
  }
}

/** Identifies a chat in logs without revealing its id. */
export function telegramTargetIdentifier(config: TelegramConfig): string {
  const hash = createHash("sha256")
    .update(`${config.chatId}:${config.threadId ?? "none"}`)
    .digest("hex")
    .slice(0, 12);

  return `tg:${hash}`;
}

export function buildTelegramText(
  title: string,
  body: string,
  data: TelegramEventData,
): string {
  const issueKey =
    data.taskNumber !== null ? `#${data.taskNumber}` : "Task update";
  const escapedTaskLabel = escapeMarkup(`${issueKey} ${data.taskTitle}`);
  const taskLine = data.taskUrl
    ? `<a href="${escapeMarkup(data.taskUrl)}">${escapedTaskLabel}</a>`
    : escapedTaskLabel;

  return [
    `<b>${escapeMarkup(title)}</b>`,
    escapeMarkup(body),
    "",
    `<b>Task:</b> ${taskLine}`,
    `<b>Project:</b> ${escapeMarkup(data.projectName)}`,
    `<b>Status:</b> ${escapeMarkup(toSentenceCase(data.status))}`,
    `<b>Priority:</b> ${escapeMarkup(toSentenceCase(data.priority))}`,
    `<b>Triggered by:</b> ${escapeMarkup(data.actorName ?? "Kaneo")}`,
  ].join("\n");
}
