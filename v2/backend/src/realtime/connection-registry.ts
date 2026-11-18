import type { ProjectConnection, UserConnection } from "./realtime-socket";

/** The sockets open on this instance: per project, and per user. */
export class ConnectionRegistry {
  readonly projects = new Map<string, Set<ProjectConnection>>();
  readonly users = new Map<string, Set<UserConnection>>();

  addProject(projectId: string, connection: ProjectConnection): void {
    let connections = this.projects.get(projectId);
    if (!connections) {
      connections = new Set();
      this.projects.set(projectId, connections);
    }
    connections.add(connection);
  }

  removeProject(projectId: string, connection: ProjectConnection): void {
    const connections = this.projects.get(projectId);
    if (!connections) return;
    connections.delete(connection);
    if (connections.size === 0) this.projects.delete(projectId);
  }

  hasProject(projectId: string, connection: ProjectConnection): boolean {
    return this.projects.get(projectId)?.has(connection) ?? false;
  }

  addUser(userId: string, connection: UserConnection): void {
    let connections = this.users.get(userId);
    if (!connections) {
      connections = new Set();
      this.users.set(userId, connections);
    }
    connections.add(connection);
  }

  removeUser(userId: string, connection: UserConnection): void {
    const connections = this.users.get(userId);
    if (!connections) return;
    connections.delete(connection);
    if (connections.size === 0) this.users.delete(userId);
  }

  /** Project sockets matching a predicate, as a snapshot safe to mutate under. */
  projectConnections(
    matches: (connection: ProjectConnection) => boolean,
  ): Array<{ projectId: string; connection: ProjectConnection }> {
    return [...this.projects].flatMap(([projectId, connections]) =>
      [...connections]
        .filter(matches)
        .map((connection) => ({ projectId, connection })),
    );
  }
}
