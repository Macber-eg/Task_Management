export type GitlabLabel = {
  id: number;
  name: string;
  color?: string;
};

export type GitlabUser = {
  id: number;
  username?: string;
  name?: string;
  avatar_url?: string | null;
};

export type GitlabIssue = {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  labels?: string[];
  author?: GitlabUser | null;
  updated_at?: string;
  confidential?: boolean;
};

export type GitlabNote = {
  id: number;
  body: string;
  system: boolean;
  internal?: boolean;
  author?: GitlabUser | null;
  created_at: string;
};

export type GitlabMergeRequest = {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  draft?: boolean;
  source_branch?: string;
  author?: GitlabUser | null;
  merged_at?: string | null;
};

export type GitlabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  name_with_namespace: string;
  visibility: string;
  web_url: string;
  permissions?: {
    project_access?: { access_level?: number } | null;
    group_access?: { access_level?: number } | null;
  } | null;
};
