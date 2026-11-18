import { escapeMarkup, toSentenceCase } from "../shared/message-text";
import type { MattermostMessage } from "./mattermost-client";

export type MattermostEventData = {
  taskTitle: string;
  taskNumber: number | null;
  projectName: string;
  taskUrl: string | null;
  actorName: string | null;
  status: string | null;
  priority: string | null;
};

export function buildMattermostMessage(
  title: string,
  body: string,
  data: MattermostEventData,
): MattermostMessage {
  const issueKey =
    data.taskNumber !== null ? `#${data.taskNumber}` : "Task update";

  return {
    text: `${title}: ${data.taskTitle}`,
    attachments: [
      {
        color: "#4f46e5",
        title: `${escapeMarkup(issueKey)} ${escapeMarkup(data.taskTitle)}`,
        title_link: data.taskUrl ?? undefined,
        text: escapeMarkup(body),
        fields: [
          {
            title: "Project",
            value: escapeMarkup(data.projectName),
            short: true,
          },
          {
            title: "Status",
            value: escapeMarkup(toSentenceCase(data.status)),
            short: true,
          },
          {
            title: "Priority",
            value: escapeMarkup(toSentenceCase(data.priority)),
            short: true,
          },
          {
            title: "Triggered by",
            value: data.actorName ? escapeMarkup(data.actorName) : "Kaneo",
            short: true,
          },
        ],
      },
    ],
  };
}
