import type { WorkspaceEntity } from "../../database/entities/workspace.entity";

/** A workspace as the organization endpoints return it; `metadata` stays the stored text. */
export function workspaceOutput(workspace: WorkspaceEntity) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    logo: workspace.logo,
    createdAt: workspace.createdAt,
    metadata: workspace.metadata,
    description: workspace.description,
  };
}

function parseMetadata(metadata: string): unknown {
  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

/**
 * The shape create and update answer with: `metadata` parsed, and left out
 * entirely when the workspace has none.
 */
export function writtenWorkspaceOutput(workspace: WorkspaceEntity) {
  const { metadata, ...rest } = workspaceOutput(workspace);
  return metadata ? { ...rest, metadata: parseMetadata(metadata) } : rest;
}
