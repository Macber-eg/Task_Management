import type { Type } from "@nestjs/common";
import {
  GITHUB_DEPS,
  type GitHubDeps,
} from "../../../src/integrations/github/github-deps";
import type { TestApp } from "../test-app";

/** The app's `GitHubDeps` (`TestApp.get` is typed for class tokens only). */
export function githubDepsOf(app: TestApp): GitHubDeps {
  return app.get(GITHUB_DEPS as unknown as Type<GitHubDeps>);
}
