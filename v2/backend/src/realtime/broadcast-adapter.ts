export type ProjectBroadcastMessage = {
  type: string;
  projectId: string;
  taskId?: string;
  tasks?: Array<{ id: string; position: number; status?: string }>;
  sourceTaskId?: string;
  targetTaskId?: string;
  linksChanged?: boolean;
  taskTitleChanged?: boolean;
};

export type BroadcastMessage = {
  projectId: string;
  message: ProjectBroadcastMessage;
  excludeInitiatorId?: string;
  /** Deliveries sharing it may share one access check. */
  authorizationBatch?: string;
};

export type UserBroadcastMessage = {
  type: string;
  [key: string]: unknown;
};

export type UserBroadcast = {
  userId: string;
  message: UserBroadcastMessage;
  /** The instance that published it, so it can ignore its own echo. */
  origin?: string;
};

export type SessionRevocation = { sessionId: string; origin: string };

/** Carries broadcasts to every API instance, this one included. */
export interface BroadcastAdapter {
  publish(msg: BroadcastMessage): Promise<void>;
  publishToUser(msg: UserBroadcast): Promise<void>;
  publishSessionRevocation(msg: SessionRevocation): Promise<void>;

  subscribe(
    handler: (msg: BroadcastMessage) => void | Promise<void>,
  ): Promise<void>;
  subscribeToUser(
    handler: (msg: UserBroadcast) => void | Promise<void>,
    onRecovery?: () => Promise<void>,
  ): Promise<void>;
  subscribeToSessionRevocations(
    handler: (msg: SessionRevocation) => void | Promise<void>,
  ): Promise<void>;

  shutdown(): Promise<void>;
}
