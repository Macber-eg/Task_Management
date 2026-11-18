import type { AccessRule } from "../access/access-rule";
import { RelationAccessHandler } from "./relation-access.handler";
import { SourceTaskAccessHandler } from "./source-task-access.handler";

/** Task relations are scoped to their source task's workspace. */
export const taskRelationAccess = {
  fromSourceTask: (): AccessRule<void> => ({
    handler: SourceTaskAccessHandler,
    options: undefined,
  }),
  fromRelation: (): AccessRule<void> => ({
    handler: RelationAccessHandler,
    options: undefined,
  }),
};
