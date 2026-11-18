import { resolveWorkspaceDescription } from "./resolve-workspace-description";

/** Select list for a `workspace` row aliased `w`. */
export const WORKSPACE_COLUMNS_SQL = `w.id, w.name, w.slug, w.logo, w.description, w.metadata,
  w.created_at AS "createdAt"`;

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  description: string | null;
  metadata: string | null;
  createdAt: Date;
  role: string | null;
};

export function toWorkspaceResponse(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    description: resolveWorkspaceDescription(row),
    createdAt: row.createdAt,
    role: row.role,
  };
}
