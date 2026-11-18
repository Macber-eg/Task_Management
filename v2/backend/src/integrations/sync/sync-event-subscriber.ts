import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../events/event-bus";
import { SyncReconciler } from "./sync-reconciler";

const TASK_LABEL_EVENTS = [
  "task.label_created",
  "task.label_deleted",
  "task.label_assigned",
  "task.label_unassigned",
  "task.labels_updated",
];

/** Reconciles sync scope whenever labels, rules or a task's project change. */
@Injectable()
export class SyncEventSubscriber implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly reconciler: SyncReconciler,
  ) {}

  onModuleInit(): void {
    for (const event of TASK_LABEL_EVENTS) {
      this.events.subscribe<{ projectId: string; taskId: string }>(
        event,
        (data) => this.reconciler.reconcileTaskSync(data.projectId, data.taskId),
      );
    }
    this.events.subscribe<{ taskId: string; toProjectId: string }>(
      "task.moved",
      (data) => this.reconciler.reconcileTaskSync(data.toProjectId, data.taskId),
    );
    this.events.subscribe<{ projectId: string; integrationId: string }>(
      "integration.sync_rules_changed",
      (data) =>
        this.reconciler.reconcileProjectSync(
          data.projectId,
          data.integrationId,
        ),
    );
    this.events.subscribe<{ projectId: string; integrationId?: string }>(
      "integration.sync_labels_changed",
      (data) =>
        this.reconciler.reconcileProjectSync(
          data.projectId,
          data.integrationId,
        ),
    );
  }
}
