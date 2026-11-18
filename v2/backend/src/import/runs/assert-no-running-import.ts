import { type EntityManager, MoreThan } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { ImportRunEntity } from "../../database/entities/import-run.entity";
import { STALE_RUN_MS } from "./to-import-run-response";

export async function assertNoRunningImport(
  manager: EntityManager,
  workspaceId: string,
) {
  const running = await manager.findOne(ImportRunEntity, {
    select: { id: true },
    where: {
      workspaceId,
      status: "running",
      heartbeatAt: MoreThan(new Date(Date.now() - STALE_RUN_MS)),
    },
  });

  if (running) {
    throw new HTTPException(409, {
      message:
        "An import is already running in this workspace. Wait for it to finish, then try again.",
    });
  }
}
