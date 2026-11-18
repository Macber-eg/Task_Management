/**
 * What the label feature asks of the external integrations (GitHub, Gitea,
 * GitLab issue labels and the sync rules that reference workspace labels).
 * One method per call the label services make, so each keeps its own order
 * and awaiting.
 */
export abstract class LabelIntegrationSync {
  abstract syncLabelToGitHub(
    taskId: string,
    name: string,
    color: string,
  ): Promise<void>;

  abstract syncLabelToGitea(
    taskId: string,
    name: string,
    color: string,
  ): Promise<void>;

  abstract syncLabelToGitlab(
    taskId: string,
    name: string,
    color: string,
  ): Promise<void>;

  abstract removeLabelFromGitHub(taskId: string, name: string): Promise<void>;

  abstract removeLabelFromGitea(taskId: string, name: string): Promise<void>;

  abstract removeLabelFromGitlab(taskId: string, name: string): Promise<void>;

  /**
   * A workspace label was renamed or is being deleted. Sync rules that select
   * it must be re-evaluated; unless `publishProjectUpdates` is false, the
   * projects with a sync integration are also announced as updated.
   */
  abstract notifySyncWorkspaceLabelChanged(
    workspaceId: string,
    labelId: string,
    options?: { publishProjectUpdates?: boolean },
  ): Promise<void>;
}
