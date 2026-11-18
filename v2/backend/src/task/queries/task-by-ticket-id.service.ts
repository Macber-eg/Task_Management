import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../../access/project-access-condition";
import { hasInstanceAdminRole } from "../../access/instance-admin-role";
import { HTTPException } from "../../common/errors/http-exception";
import { isSameProjectKey, mayMatchProjectKeySql } from "../shared/project-key";
import { TICKET_ID_PATTERN } from "../shared/ticket-id";
import { TaskDetailService } from "./task-detail.service";

type Candidate = {
  id: string;
  workspaceId: string;
  slug: string;
  archivedAt: Date | null;
};

export type TicketIdScope = {
  workspaceId?: string;
  workspaceSlug?: string;
  projectId?: string;
};

/** Resolves `KEY-12` to the one accessible task it names. */
@Injectable()
export class TaskByTicketIdService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly detail: TaskDetailService,
  ) {}

  async getTaskByTicketId(
    ticketId: string,
    userId: string,
    { workspaceId, workspaceSlug, projectId }: TicketIdScope = {},
  ) {
    const match = ticketId.normalize("NFKC").match(TICKET_ID_PATTERN);
    const projectKey = match?.[1];
    const number = Number(match?.[2]);
    if (
      !projectKey ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      number > 2_147_483_647
    ) {
      throw new HTTPException(400, { message: "Invalid task ticket ID" });
    }

    const [user] = (await this.dataSource.query(
      `SELECT role FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as { role: string | null }[];

    const slugWorkspaceIds = workspaceSlug
      ? await this.findWorkspaceIdsBySlug(workspaceSlug)
      : undefined;

    const parameters: unknown[] = [
      number,
      projectKey.normalize("NFKC"),
      userId,
    ];
    const conditions = [
      "t.number = $1",
      mayMatchProjectKeySql("p", "$2"),
      projectAccessCondition("$3", "p.id"),
    ];
    const add = (sql: string, value: unknown) => {
      parameters.push(value);
      conditions.push(sql.replace("?", `$${parameters.length}`));
    };
    if (workspaceId) add("p.workspace_id = ?", workspaceId);
    if (slugWorkspaceIds)
      add("p.workspace_id = ANY(?::text[])", slugWorkspaceIds);
    if (projectId) add("p.id = ?", projectId);
    if (!hasInstanceAdminRole(user?.role))
      conditions.push(
        "p.workspace_id IN (SELECT wm.workspace_id FROM workspace_member wm WHERE wm.user_id = $3)",
      );

    const candidates = (await this.dataSource.query(
      `SELECT t.id, p.workspace_id AS "workspaceId", p.slug,
         p.archived_at AS "archivedAt"
       FROM task t INNER JOIN project p ON t.project_id = p.id
       WHERE ${conditions.join(" AND ")}`,
      parameters,
    )) as Candidate[];

    const rank = (candidate: { archivedAt: Date | null }) =>
      candidate.archivedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const [matchedTask, nextMatch] = candidates
      .filter((candidate) => isSameProjectKey(candidate.slug, projectKey))
      .sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) > rank(b) ? -1 : 1));
    if (!matchedTask) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    if (nextMatch && rank(nextMatch) === rank(matchedTask)) {
      throw new HTTPException(409, {
        message: "Task ticket ID matches multiple accessible tasks",
      });
    }

    return {
      ...(await this.detail.getTask(matchedTask.id)),
      workspaceId: matchedTask.workspaceId,
    };
  }

  private async findWorkspaceIdsBySlug(workspaceSlug: string) {
    const slugMatches = (await this.dataSource.query(
      `SELECT id, slug FROM workspace WHERE lower(slug) = lower($1)`,
      [workspaceSlug],
    )) as { id: string; slug: string }[];
    const exactMatch = slugMatches.find(
      (workspace) => workspace.slug === workspaceSlug,
    );
    const ids = exactMatch
      ? [exactMatch.id]
      : slugMatches.map((workspace) => workspace.id);
    if (ids.length === 0) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    return ids;
  }
}
