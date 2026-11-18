import type { EntityManager } from "typeorm";
import type { EventBus } from "../events/event-bus";
import { listAccessibleProjectIds } from "./list-accessible-project-ids";

/** Announces that the member lists of the user's projects changed. */
export async function publishMemberProjects(
  manager: EntityManager,
  events: EventBus,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const projectIds = await listAccessibleProjectIds(
    manager,
    workspaceId,
    userId,
  );
  await events.publish("project_members.updated", {
    workspaceId,
    projectIds: [...projectIds],
  });
}
