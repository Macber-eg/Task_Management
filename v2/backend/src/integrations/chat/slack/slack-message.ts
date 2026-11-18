import { escapeMarkup, toSentenceCase } from "../shared/message-text";
import type { SlackMessage } from "./slack-client";

export type SlackEventData = {
  taskTitle: string;
  taskNumber: number | null;
  projectName: string;
  taskUrl: string | null;
  actorName: string | null;
  status: string | null;
  priority: string | null;
};

export function buildSlackMessage(
  title: string,
  body: string,
  data: SlackEventData,
): SlackMessage {
  const issueKey =
    data.taskNumber !== null ? `#${data.taskNumber}` : "Task update";
  const escapedIssueKey = escapeMarkup(issueKey);
  const escapedTaskTitle = escapeMarkup(data.taskTitle);
  const taskLabel = data.taskUrl
    ? `<${data.taskUrl}|${escapedIssueKey} ${escapedTaskTitle}>`
    : `${escapedIssueKey} ${escapedTaskTitle}`;

  return {
    text: `${title}: ${data.taskTitle}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escapeMarkup(title)}*\n${escapeMarkup(body)}`,
        },
        fields: [
          { type: "mrkdwn", text: `*Task*\n${taskLabel}` },
          {
            type: "mrkdwn",
            text: `*Project*\n${escapeMarkup(data.projectName)}`,
          },
          {
            type: "mrkdwn",
            text: `*Status*\n${escapeMarkup(toSentenceCase(data.status))}`,
          },
          {
            type: "mrkdwn",
            text: `*Priority*\n${escapeMarkup(toSentenceCase(data.priority))}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: data.actorName
              ? `Triggered by ${escapeMarkup(data.actorName)}`
              : "Triggered by Kaneo",
          },
        ],
      },
    ],
  };
}
