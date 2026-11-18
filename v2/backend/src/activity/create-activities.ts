import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { ActivityEntity } from "../database/entities/activity.entity";

export type NewActivity = Pick<ActivityEntity, "taskId" | "type"> &
  Partial<
    Pick<
      ActivityEntity,
      | "userId"
      | "content"
      | "eventData"
      | "externalUserName"
      | "externalUserAvatar"
      | "externalSource"
      | "externalUrl"
    >
  >;

// Postgres caps a statement at 65535 bind parameters and each row binds a
// handful of columns, so a batch that scales with a project's task count has
// to be chunked rather than sent as one statement.
const INSERT_CHUNK_SIZE = 500;

export async function createActivities(
  manager: EntityManager,
  activities: NewActivity[],
): Promise<void> {
  for (let index = 0; index < activities.length; index += INSERT_CHUNK_SIZE) {
    const rows = activities
      .slice(index, index + INSERT_CHUNK_SIZE)
      .map((activity) => ({ id: createId(), ...activity }));
    await manager
      .createQueryBuilder()
      .insert()
      .into(ActivityEntity)
      // `eventData` is `unknown` on the entity, which the builder's type rejects.
      .values(rows as QueryDeepPartialEntity<ActivityEntity>[])
      .updateEntity(false)
      .execute();
  }
}
