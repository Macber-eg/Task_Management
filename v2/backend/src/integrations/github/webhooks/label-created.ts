import { LabelEntity } from "../../../database/entities/label.entity";
import { insertReturning } from "../../../database/dml";
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";

export type LabelCreatedPayload = {
  action: string;
  label: { name: string; color: string; description?: string | null };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

/** A repository label becomes a workspace label of each bound project. */
export async function handleLabelCreated(
  deps: GitHubDeps,
  payload: LabelCreatedPayload,
): Promise<void> {
  const { label } = payload;

  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const workspaceId = integration.project.workspaceId;
    if (!workspaceId) continue;

    // Any label of that name, workspace-wide or on a task, already counts.
    const labelExists = await deps.db.findOne(LabelEntity, {
      where: { workspaceId, name: label.name },
    });
    if (labelExists) continue;

    await insertReturning(
      deps.db,
      LabelEntity,
      {
        name: label.name,
        color: label.color ? `#${label.color}` : "#6B7280",
        workspaceId,
        taskId: null,
      },
      {
        onConflict: {
          target: ["workspaceId", "name"],
          where: "task_id IS NULL",
        },
      },
    );
  }
}
