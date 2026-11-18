export type SearchType =
  "all" | "tasks" | "projects" | "workspaces" | "comments" | "activities";

export type SearchResult = {
  id: string;
  type: "task" | "project" | "workspace" | "comment" | "activity";
  title: string;
  description?: string;
  content?: string;
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  userId?: string;
  userName?: string;
  createdAt: Date;
  relevanceScore: number;
  taskNumber?: number;
  projectSlug?: string;
  priority?: string;
  status?: string;
};

/** Where a search may look, and for whom. */
export type SearchScope = {
  userId: string;
  workspaceId?: string;
  accessibleWorkspaceIds: string[];
  projectId?: string;
  limit: number;
  /** `%query%`, lower-cased, for LIKE and ILIKE. */
  pattern: string;
};
