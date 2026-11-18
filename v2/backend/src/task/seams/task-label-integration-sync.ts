/**
 * What bulk label removal asks of the issue-tracker integrations (GitHub,
 * Gitea, GitLab). Called fire-and-forget, one call per provider and label.
 */
export abstract class TaskLabelIntegrationSync {
  abstract removeLabelFromGitHub(taskId: string, name: string): Promise<void>;

  abstract removeLabelFromGitea(taskId: string, name: string): Promise<void>;

  abstract removeLabelFromGitlab(taskId: string, name: string): Promise<void>;
}
