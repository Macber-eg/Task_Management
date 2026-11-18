/** Workspace member row from `organization.listMembers`. */
export type WorkspaceMemberListItem = {
  userId: string;
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
};

/** Supports legacy `{ members }` payloads and the current members array. */
export function asWorkspaceMembers(
  data:
    | WorkspaceMemberListItem[]
    | { members?: WorkspaceMemberListItem[] }
    | null
    | undefined,
): WorkspaceMemberListItem[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.members ?? [];
}
