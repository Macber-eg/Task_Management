import type { FactoryProvider } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { EventBus } from "../../events/event-bus";
import { GitHubApp } from "./app/github-app";

/** What the GitHub handlers need: the database, the event bus and the App. */
export type GitHubDeps = {
  db: EntityManager;
  events: EventBus;
  github: GitHubApp;
};

export const GITHUB_DEPS = Symbol("GITHUB_DEPS");

export const gitHubDepsProvider: FactoryProvider<GitHubDeps> = {
  provide: GITHUB_DEPS,
  inject: [DataSource, EventBus, GitHubApp],
  useFactory: (dataSource: DataSource, events: EventBus, github: GitHubApp) => ({
    db: dataSource.manager,
    events,
    github,
  }),
};
