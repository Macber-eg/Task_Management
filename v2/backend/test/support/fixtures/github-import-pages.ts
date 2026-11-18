/** GraphQL import pages as GitHub answers them, for the `octokit.graphql` double. */

export const OLD_GITHUB_DATE = "2020-01-01T00:00:00Z";

export function connection<T>(
  nodes: T[],
  more = false,
  cursor: string | null = null,
  totalCount = nodes.length,
) {
  return {
    nodes,
    totalCount,
    pageInfo: { hasNextPage: more, endCursor: cursor },
  };
}

export function importedIssue(
  number: number,
  options: Record<string, unknown> = {},
) {
  return {
    number,
    title: `Issue ${number}`,
    body: "Description",
    url: `https://github.com/example/repo/issues/${number}`,
    state: "OPEN",
    createdAt: OLD_GITHUB_DATE,
    author: null,
    labels: connection([]),
    comments: connection([]),
    ...options,
  };
}

export function importedComment(
  number: number,
  options: Record<string, unknown> = {},
) {
  return {
    body: `Comment ${number}`,
    url: `https://github.com/example/repo/issues/1#issuecomment-${number}`,
    createdAt: OLD_GITHUB_DATE,
    author: {
      login: "contributor",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      __typename: "User",
    },
    ...options,
  };
}

export function importedLabel(number: number) {
  return { name: `label-${number}`, color: "abcdef" };
}

export function issuePage(
  nodes: unknown[],
  more = false,
  cursor: string | null = null,
  total = nodes.length,
  databaseId = 2,
) {
  return {
    repository: {
      databaseId,
      issues: connection(nodes, more, cursor, total),
    },
  };
}

export function pullsPage(
  nodes: unknown[],
  more = false,
  cursor: string | null = null,
  total = nodes.length,
) {
  return {
    repository: {
      databaseId: 2,
      pullRequests: connection(nodes, more, cursor, total),
    },
  };
}

export const emptyPulls = () => pullsPage([]);

/** The binding the import tests use: installation 1, repository 2 (`example/repo`). */
export function importGitHubConfig(
  verifiedByUserId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    repositoryOwner: "example",
    repositoryName: "repo",
    installationId: 1,
    repositoryId: 2,
    verifiedGithubAccountId: "3",
    verifiedByUserId,
    ...extra,
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
