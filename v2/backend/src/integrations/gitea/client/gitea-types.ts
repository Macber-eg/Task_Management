export type GiteaLabel = {
  id: number;
  name: string;
  color?: string;
};

type GiteaUser = { login?: string; username?: string; avatar_url?: string };

export type GiteaIssue = {
  updated_at?: string;
  content_version?: number;
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels?: GiteaLabel[];
  user?: GiteaUser | null;
  pull_request?: unknown;
};

export type GiteaComment = {
  id: number;
  body: string;
  html_url: string;
  user?: GiteaUser | null;
  created_at: string;
};

export type GiteaPullRequest = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  head?: { ref?: string };
  user?: GiteaUser | null;
  merged?: boolean;
  merged_at?: string | null;
};

export type GiteaRepository = {
  name: string;
  owner: { login?: string; username?: string };
  html_url: string;
  private: boolean;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
};

export type GiteaRepositoryListItem = {
  id: number;
  name: string;
  full_name: string;
  owner: { login?: string; username?: string };
  private: boolean;
  html_url: string;
};
