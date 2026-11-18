import type { EntityManager } from "typeorm";
import type { EventBus } from "../../events/event-bus";
import type { PluginContext, TaskCreatedEvent } from "../core/task-events";
import { updateExternalLink } from "../links/external-link-writes";
import { parseLinkMetadata } from "../links/parse-link-metadata";
import { createIssueWrite } from "./dispatch-issue-write";
import { initializeTaskState } from "./initialize-task-state";
import { initializeTaskText } from "./initialize-task-text";

type Initialization = {
  syncInitializationPending?: boolean;
  syncInitializedLabels?: boolean;
  syncInitializedComment?: boolean;
};
type Link = { id: string; metadata?: string | null };

/** Whether an exported issue still needs `initializeTaskIssue`. */
export function isIssueInitializationPending(link: Link): boolean {
  return (
    parseLinkMetadata<Initialization>(link.metadata, {
      externalLinkId: link.id,
      source: "sync_creation",
    }).syncInitializationPending === true
  );
}

/**
 * Brings a newly created issue up to date with its task: text, open/closed
 * state, labels and the optional task-link comment. Each step is recorded on
 * the link, so a retry resumes where a failed attempt stopped.
 */
export async function initializeTaskIssue(
  db: EntityManager,
  events: EventBus,
  event: TaskCreatedEvent,
  context: PluginContext,
  link: Link,
  actions: {
    text: (
      field: "title" | "description",
      value: string,
    ) => Promise<string | undefined>;
    state: (value: string) => Promise<string | undefined>;
    labels: () => Promise<string | undefined>;
    comment?: () => Promise<unknown>;
    commentExists?: () => Promise<boolean>;
  },
): Promise<void> {
  const current = await initializeTaskText(
    db,
    events,
    event,
    context,
    link,
    actions.text,
  );
  const progress = parseLinkMetadata<Initialization>(link.metadata, {
    externalLinkId: link.id,
    source: "sync_creation",
  });
  const write = createIssueWrite(
    db,
    { ...link, taskId: event.taskId, integrationId: context.integrationId },
    JSON.stringify(context.config),
  );
  await initializeTaskState(db, events, current, context, link, actions.state);
  if (!progress.syncInitializedLabels) {
    if ((await actions.labels()) === undefined)
      throw new Error("Issue sync scope changed");
    await updateExternalLink(db, link.id, {
      metadata: { syncInitializedLabels: true },
    });
  }
  if (!progress.syncInitializedComment && actions.comment) {
    if (!(await actions.commentExists?.())) await write(actions.comment);
    await updateExternalLink(db, link.id, {
      metadata: { syncInitializedComment: true },
    });
  }
  await updateExternalLink(db, link.id, {
    metadata: { syncInitializationPending: false },
  });
}
