import { randomUUID } from "node:crypto";
import type { ProjectBroadcastMessage } from "./broadcast-adapter";

export type QueuedBroadcast = {
  message: ProjectBroadcastMessage;
  excludeInitiatorId?: string;
};

const BATCH_DELAY_MS = 100;

function messageKey(message: ProjectBroadcastMessage) {
  // Every reorder carries its own positions, so none may replace another.
  const type =
    message.type === "TASKS_REORDERED"
      ? `${message.type}:${randomUUID()}`
      : message.type;
  return `${type}:${message.taskId ?? ""}:${message.sourceTaskId ?? ""}:${message.targetTaskId ?? ""}`;
}

/**
 * Collects a project's broadcasts for 100ms and hands them over at once, so
 * a burst of changes to one task reaches clients as one message.
 */
export class ProjectBroadcastQueue {
  private readonly queues = new Map<string, Map<string, QueuedBroadcast>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly flush: (projectId: string, queued: QueuedBroadcast[]) => void,
  ) {}

  enqueue(
    projectId: string,
    message: ProjectBroadcastMessage,
    excludeInitiatorId?: string,
  ): void {
    let queue = this.queues.get(projectId);
    if (!queue) {
      queue = new Map();
      this.queues.set(projectId, queue);
    }
    const key = messageKey(message);
    const previous = queue.get(key);
    queue.set(key, {
      message: {
        ...message,
        ...(previous?.message.linksChanged ? { linksChanged: true } : {}),
        ...(previous?.message.taskTitleChanged
          ? { taskTitleChanged: true }
          : {}),
      },
      excludeInitiatorId,
    });

    if (this.timers.has(projectId)) return;
    this.timers.set(
      projectId,
      setTimeout(() => {
        this.timers.delete(projectId);
        const pending = this.queues.get(projectId);
        this.queues.delete(projectId);
        if (pending) this.flush(projectId, [...pending.values()]);
      }, BATCH_DELAY_MS),
    );
  }

  /** Drops what is queued for a project whose sockets were just closed. */
  discard(projectId: string): void {
    const timer = this.timers.get(projectId);
    if (timer) clearTimeout(timer);
    this.timers.delete(projectId);
    this.queues.delete(projectId);
  }

  /** Stops every timer and returns what had not been flushed yet. */
  drain(): Array<[projectId: string, queued: QueuedBroadcast[]]> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const pending = [...this.queues].map(
      ([projectId, queue]) =>
        [projectId, [...queue.values()]] as [string, QueuedBroadcast[]],
    );
    this.queues.clear();
    return pending;
  }
}
