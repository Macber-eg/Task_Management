import type { EntityManager } from "typeorm";
import { createMember } from "./create-member";
import { createProjectFixture } from "./create-project-fixture";
import { createTask } from "./create-task";
import { createWorkspaceMember } from "./create-workspace-member";
import { restrictToProjects } from "./restrict-to-projects";

/**
 * An owner's workspace with projects Alpha and Beta, and a member limited to
 * Alpha who is assigned one task in each.
 */
export async function createRestrictedWorkspace(db: EntityManager) {
  const { user: owner, workspace } = await createWorkspaceMember(db, {
    role: "owner",
  });
  const alpha = await createProjectFixture(db, {
    workspaceId: workspace.id,
    name: "Alpha",
  });
  const beta = await createProjectFixture(db, {
    workspaceId: workspace.id,
    name: "Beta",
  });
  const restricted = await createMember(db, workspace.id);
  await restrictToProjects(db, workspace.id, restricted.id, [alpha.project.id]);

  const alphaTask = await createTask(db, {
    projectId: alpha.project.id,
    title: "Visible alpha task",
    columnId: alpha.columns.todo.id,
    userId: restricted.id,
  });
  const betaTask = await createTask(db, {
    projectId: beta.project.id,
    title: "Hidden beta task",
    columnId: beta.columns.todo.id,
    userId: restricted.id,
  });

  return {
    owner,
    workspace,
    restricted,
    alpha: alpha.project,
    beta: beta.project,
    alphaTask,
    betaTask,
  };
}
