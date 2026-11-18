import { toSentenceCase } from "../shared/message-text";
import type { DiscordMessage } from "./discord-client";

export type DiscordEventData = {
  taskTitle: string;
  taskNumber: number | null;
  projectName: string;
  taskUrl: string | null;
  actorName: string | null;
  statusSlug: string;
  columnName: string | null;
  priority: string | null;
};

/** Breaks mentions so a task title cannot ping @everyone, roles or users. */
export function sanitizeDiscordContent(value: string): string {
  return value
    .replace(/@everyone/g, "@\u200beveryone")
    .replace(/@here/g, "@\u200bhere")
    .replace(/<@&/g, "<@\u200b&")
    .replace(/<@!?\d+>/g, (match) => `<@\u200b${match.slice(2)}`)
    .replace(/<#\d+>/g, (match) => `<#\u200b${match.slice(2)}`)
    .replace(/<:\w+:\d+>/g, (match) => `<:\u200b${match.slice(2)}`)
    .replace(/<a:\w+:\d+>/g, (match) => `<a:\u200b${match.slice(3)}`);
}

export function buildDiscordMessage(
  title: string,
  body: string,
  data: DiscordEventData,
): DiscordMessage {
  const issueKey =
    data.taskNumber !== null ? `#${data.taskNumber}` : "Task update";
  const safeTitle = sanitizeDiscordContent(title);
  const safeTaskLabel = sanitizeDiscordContent(`${issueKey} ${data.taskTitle}`);
  const safeActor = data.actorName
    ? sanitizeDiscordContent(data.actorName)
    : null;

  return {
    content: `${safeTitle}: ${safeTaskLabel}`,
    embeds: [
      {
        title: safeTitle,
        description: sanitizeDiscordContent(body),
        url: data.taskUrl ?? undefined,
        color: 0x5865f2,
        fields: [
          {
            name: "Task",
            value: data.taskUrl
              ? `[${safeTaskLabel}](${data.taskUrl})`
              : safeTaskLabel,
            inline: true,
          },
          {
            name: "Project",
            value: sanitizeDiscordContent(data.projectName),
            inline: true,
          },
          {
            name: "Status",
            value: sanitizeDiscordContent(
              data.columnName ?? toSentenceCase(data.statusSlug),
            ),
            inline: true,
          },
          {
            name: "Priority",
            value: sanitizeDiscordContent(toSentenceCase(data.priority)),
            inline: true,
          },
        ],
        footer: {
          text: safeActor ? `Triggered by ${safeActor}` : "Triggered by Kaneo",
        },
      },
    ],
  };
}
