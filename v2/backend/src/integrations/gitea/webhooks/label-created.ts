import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";

/** Gitea label events include the created label; older payloads may also set ref_type. */
export type LabelCreatePayload = {
  ref?: string;
  ref_type?: string;
  label?: {
    name: string;
    color: string;
    description?: string | null;
  };
  repository: GiteaWebhookRepository;
};

/** A repository label was created: adds it as a workspace label. */
export async function handleGiteaLabelCreated(
  db: EntityManager,
  payload: LabelCreatePayload,
  integrationId?: string,
): Promise<void> {
  if ((payload.ref_type && payload.ref_type !== "label") || !payload.label) {
    return;
  }

  const { repository, label } = payload;
  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    const workspaceId = integration.project?.workspaceId;
    if (!workspaceId) {
      continue;
    }

    const color = label.color ? `#${label.color.replace(/^#/, "")}` : "#6B7280";

    await insertReturning(
      db,
      LabelEntity,
      { name: label.name, color, workspaceId },
      {
        onConflict: {
          target: ["workspaceId", "name"],
          where: "task_id IS NULL",
        },
      },
    );
  }
}
