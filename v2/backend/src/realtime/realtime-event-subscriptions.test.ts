import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHub,
  createRedisHub,
  type FakeReader,
  fakeReader,
  fakeRedis,
  fakeSocket,
  sentMessages,
} from "../../test/support/realtime-hub-fakes";
import { EventBus } from "../events/event-bus";
import { eventContext } from "../events/event-context";
import type { RealtimeAccessReader } from "./realtime-access-reader";
import { RealtimeEventSubscriptions } from "./realtime-event-subscriptions";
import type { RealtimeHub } from "./realtime-hub";

let reader: FakeReader;
let events: EventBus;
let hub: RealtimeHub;

async function wire(target: RealtimeHub) {
  hub = target;
  await hub.start();
  events = new EventBus();
  new RealtimeEventSubscriptions(
    events,
    hub,
    reader as unknown as RealtimeAccessReader,
  ).onModuleInit();
}

function connect(projectId: string, userId: string, initiatorId: string) {
  const socket = fakeSocket();
  hub.addProjectConnection(projectId, socket, {
    userId,
    initiatorId,
    workspaceId: "workspace",
    sessionId: null,
  });
  return socket;
}

beforeEach(() => {
  reader = fakeReader();
  reader.projectWorkspaceId.mockResolvedValue("workspace");
  reader.workspaceMemberIds.mockImplementation(async (_workspace, ids) => [
    ...ids,
  ]);
});

afterEach(async () => {
  await hub.stop();
  vi.useRealTimers();
});

describe("awaited label deletion broadcasts", () => {
  it("delivers immediately through the in-memory adapter and excludes the initiator", async () => {
    await wire(createHub(reader));
    const observer = connect("project", "observer", "other");
    const initiator = connect("project", "initiator", "self");
    const foreign = connect("foreign", "foreign", "another");

    await eventContext.run({ initiatorId: "self" }, () =>
      events.publish(
        "task.label_deleted",
        { projectId: "project", taskId: "task" },
        { waitForHandlers: true },
      ),
    );

    expect(sentMessages(observer)).toEqual([
      { type: "TASK_LABEL_UPDATED", projectId: "project", taskId: "task" },
    ]);
    expect(initiator.send).not.toHaveBeenCalled();
    expect(foreign.send).not.toHaveBeenCalled();
  });

  it("does not complete the event while Redis is awaiting publication", async () => {
    const redis = fakeRedis();
    let release!: () => void;
    redis.publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(1);
        }),
    );
    await wire(createRedisHub(reader, redis));
    let completed = false;
    const operation = events
      .publish(
        "task.label_deleted",
        { projectId: "project", taskId: "task" },
        { waitForHandlers: true },
      )
      .then(() => {
        completed = true;
      });
    await vi.waitFor(() => expect(redis.publish).toHaveBeenCalledTimes(1));
    expect(completed).toBe(false);
    expect(redis.published()[0]).toMatchObject({
      channel: "kaneo:ws:project:broadcast",
      projectId: "project",
      message: { type: "TASK_LABEL_UPDATED", taskId: "task" },
    });
    release();
    await operation;
    expect(completed).toBe(true);
  });
});

it("broadcasts project updates and keeps a link refresh through batching", async () => {
  await wire(createHub(reader));
  const socket = connect("proj-1", "user-1", "init-1");
  await events.publish("project.updated", {
    projectId: "proj-1",
    linksChanged: true,
  });
  await events.publish("project.updated", { projectId: "proj-1" });
  await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce(), {
    timeout: 300,
  });
  expect(sentMessages(socket)[0]).toEqual({
    type: "PROJECT_UPDATED",
    projectId: "proj-1",
    linksChanged: true,
  });
});

it("keeps title-change hints through batching without broadcasting private titles", async () => {
  await wire(createHub(reader));
  const socket = connect("proj-1", "user-1", "init-1");
  for (const newTitle of ["First", "Current"])
    await events.publish("task.title_changed", {
      projectId: "proj-1",
      taskId: "t1",
      newTitle,
    });
  hub.broadcastToProject("proj-1", {
    type: "TASK_UPDATED",
    projectId: "proj-1",
    taskId: "t1",
  });
  await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce(), {
    timeout: 300,
  });
  expect(sentMessages(socket)[0]).toMatchObject({ taskTitleChanged: true });
  const raw = socket.send.mock.calls[0]?.[0];
  expect(raw).not.toContain("Current");
  expect(raw).not.toContain("First");
});

it.each([1, 2])(
  "delivers %i committed reorder batch through the subscriber and local adapter",
  async (batches) => {
    vi.useFakeTimers();
    await wire(createHub(reader));
    const socket = connect("project", "observer", "window");
    const tasks = [
      { id: "one", position: 1, status: "to-do" },
      { id: "two", position: 0, status: "to-do" },
    ];
    for (let index = 0; index < batches; index++)
      await events.publish(
        "tasks.reordered",
        { projectId: "project", userId: "actor", tasks },
        { waitForHandlers: true },
      );
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.send).toHaveBeenCalledTimes(batches);
    expect(sentMessages(socket)[0]).toEqual({
      type: "TASKS_REORDERED",
      projectId: "project",
      tasks,
    });
  },
);

it("maps task, relation and comment events and refreshes parent boards", async () => {
  vi.useFakeTimers();
  await wire(createHub(reader));
  reader.subtaskParentProjects.mockResolvedValue([
    { projectId: "parent" },
    { projectId: "project" },
  ]);
  const board = connect("project", "user", "window");
  const parent = connect("parent", "user", "window");
  for (const [event, extra] of [
    ["task.status_changed", {}],
    ["comment.created", {}],
    ["task-relation.created", { sourceTaskId: "a", targetTaskId: "b" }],
  ] as const)
    await events.publish(
      event,
      { projectId: "project", taskId: "task", ...extra },
      { waitForHandlers: true },
    );
  await vi.advanceTimersByTimeAsync(100);
  expect(sentMessages(board).map((message) => message.type)).toEqual([
    "TASK_UPDATED",
    "COMMENT_UPDATED",
    "TASK_RELATION_UPDATED",
  ]);
  expect(sentMessages(parent)).toEqual([
    { type: "TASK_RELATION_UPDATED", projectId: "parent", taskId: "" },
  ]);
  expect(reader.subtaskParentProjects).toHaveBeenCalledWith(["task"]);
});

it("notifies user sockets of new notifications", async () => {
  await wire(createHub(reader));
  const tab = fakeSocket();
  hub.addUserConnection("user", tab);
  await events.publish("notification.created", {
    notificationId: "n",
    userId: "user",
  });
  expect(sentMessages(tab)).toEqual([{ type: "NOTIFICATION_CREATED" }]);
});

it("tells every board of the workspace that its members changed", async () => {
  vi.useFakeTimers();
  await wire(createHub(reader));
  reader.workspaceProjectIds.mockResolvedValue(["project", "other"]);
  const board = connect("project", "user", "window");
  await events.publish(
    "project_members.updated",
    { workspaceId: "workspace" },
    { waitForHandlers: true },
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(sentMessages(board)).toEqual([
    { type: "PROJECT_MEMBERS_UPDATED", projectId: "project" },
  ]);
  expect(reader.workspaceProjectIds).toHaveBeenCalledWith("workspace");
});
