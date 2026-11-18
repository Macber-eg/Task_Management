import type { TeamEntity } from "../../database/entities/team.entity";

export function teamOutput(team: TeamEntity) {
  return {
    id: team.id,
    name: team.name,
    organizationId: team.workspaceId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}
