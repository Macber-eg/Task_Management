import type { SourceProject } from "../types";
import type { TrelloBoardSummary, TrelloOrganization } from "./client";

export function mapBoardSummaries(
  boards: TrelloBoardSummary[],
  organizations: TrelloOrganization[],
): SourceProject[] {
  const workspaceNames = new Map(
    organizations.map((organization) => [
      organization.id,
      organization.displayName?.trim(),
    ]),
  );

  return boards
    .map((board) => {
      const detail = board.idOrganization
        ? workspaceNames.get(board.idOrganization)
        : "Personal";
      return {
        id: board.id,
        name: board.name.trim() || "Untitled board",
        ...(detail ? { detail } : {}),
      };
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}
