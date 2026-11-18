import { setImmediate } from "node:timers/promises";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { boundedTaskRead } from "../project/public-board/bounded-task-read";
import { type CalendarTask, streamCalendar } from "./ical";

export const CALENDAR_TASK_BATCH_SIZE = 50;
export const CALENDAR_DESCRIPTION_CHARACTERS = 4096;
const CALENDAR_TITLE_CHARACTERS = 1024;

// Limit text in PostgreSQL so oversized descriptions never enter API memory.
function excerpt(column: string, characters: number) {
  return `case when char_length(${column}) > ${characters}
    then left(${column}, ${characters}) || '…'
    else ${column} end`;
}

type FeedRecord = {
  labelIds: string[];
  timeZone: string;
  projectId: string;
  workspaceId: string;
  name: string;
};

/** Serves a calendar feed by its secret token, streaming tasks in batches. */
@Injectable()
export class CalendarFeedReaderService {
  constructor(private readonly dataSource: DataSource) {}

  async getCalendarFeed(token: string): Promise<ReadableStream<Uint8Array>> {
    const manager = this.dataSource.manager;
    const [record] = (await manager.query(
      `SELECT feed.label_ids AS "labelIds", feed.time_zone AS "timeZone",
              project.id AS "projectId", project.workspace_id AS "workspaceId",
              ${excerpt("project.name", CALENDAR_TITLE_CHARACTERS)} AS name
       FROM calendar_feed AS feed
       INNER JOIN project ON project.id = feed.project_id
       WHERE feed.token = $1`,
      [token],
    )) as FeedRecord[];
    if (!record)
      throw new HTTPException(404, { message: "Calendar feed not found" });
    // Resolve ids on every refresh so renaming a label keeps subscriptions.
    // Missing or deleted labels must never broaden a feed to all tasks.
    const labels = record.labelIds.length
      ? ((await manager.query(
          `SELECT name FROM label
           WHERE workspace_id = $1 AND id = ANY($2::text[])`,
          [record.workspaceId, record.labelIds],
        )) as { name: string }[])
      : [];

    return streamCalendar({
      name: record.name,
      timeZone: record.timeZone,
      tasks: this.tasks(
        record,
        labels.map((label) => label.name),
      ),
    });
  }

  private async *tasks(
    feed: FeedRecord,
    labelNames: string[],
  ): AsyncGenerator<CalendarTask> {
    if (feed.labelIds.length && !labelNames.length) return;
    let after: string | undefined;
    while (true) {
      const page = await boundedTaskRead(this.dataSource, (tx) =>
        this.readPage(tx, feed, labelNames, after),
      );
      yield* page;
      const last = page.at(-1);
      if (!last || page.length < CALENDAR_TASK_BATCH_SIZE) return;
      after = last.id;
      // Let pending requests run even when the subscriber reads immediately.
      await setImmediate();
    }
  }

  private readPage(
    manager: EntityManager,
    feed: FeedRecord,
    labelNames: string[],
    after: string | undefined,
  ): Promise<CalendarTask[]> {
    const parameters: unknown[] = [feed.projectId, CALENDAR_TASK_BATCH_SIZE];
    const conditions = [
      "task.project_id = $1",
      "(task.start_date IS NOT NULL OR task.due_date IS NOT NULL)",
    ];
    if (after) {
      parameters.push(after);
      conditions.push(`task.id > $${parameters.length}`);
    }
    if (feed.labelIds.length) {
      parameters.push(feed.workspaceId, labelNames);
      conditions.push(`EXISTS (
        SELECT label.id FROM label
        WHERE label.task_id = task.id
          AND label.workspace_id = $${parameters.length - 1}
          AND label.name = ANY($${parameters.length}::text[])
      )`);
    }
    return manager.query(
      `SELECT task.id,
              ${excerpt("task.title", CALENDAR_TITLE_CHARACTERS)} AS title,
              ${excerpt("task.description", CALENDAR_DESCRIPTION_CHARACTERS)}
                AS description,
              task.start_date AS "startDate", task.due_date AS "dueDate",
              task.created_at AS "createdAt", task.updated_at AS "updatedAt"
       FROM task
       WHERE ${conditions.join(" AND ")}
       ORDER BY task.id ASC
       LIMIT $2`,
      parameters,
    );
  }
}
