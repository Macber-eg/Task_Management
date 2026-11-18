import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { boundedTaskRead } from "./bounded-task-read";
import {
  DESCRIPTION_CHUNK_CHARACTERS,
  DESCRIPTION_MATCH_PAGE_SIZE,
  descriptionDeferredSql,
} from "./description-sql";

type PageRow = { content: string; version: string };

export type DescriptionPageOptions = { offset: number; version?: string };

const UNAVAILABLE =
  "Description changed or is unavailable; refresh before loading it again";

function toPage(row: PageRow | undefined, options: DescriptionPageOptions) {
  if (!row)
    throw new HTTPException(options.version ? 409 : 404, {
      message: UNAVAILABLE,
    });
  // PostgreSQL offsets count Unicode characters, not JavaScript UTF-16 units.
  const characters = Array.from(row.content);
  return {
    content: characters.slice(0, DESCRIPTION_CHUNK_CHARACTERS).join(""),
    version: row.version,
    nextOffset:
      characters.length > DESCRIPTION_CHUNK_CHARACTERS
        ? options.offset + DESCRIPTION_CHUNK_CHARACTERS
        : null,
  };
}

function chunkOf(column: string) {
  return `coalesce(substring(${column} from $1::integer for ${DESCRIPTION_CHUNK_CHARACTERS + 1}::integer), '')`;
}

/** Large task and project descriptions, read in bounded chunks. */
@Injectable()
export class DescriptionPageService {
  constructor(private readonly dataSource: DataSource) {}

  getDescriptionPage(
    taskId: string,
    options: DescriptionPageOptions & { publicProjectId?: string },
  ) {
    return boundedTaskRead(this.dataSource, async (tx) => {
      const parameters: unknown[] = [options.offset + 1, taskId];
      let conditions = "t.id = $2";
      if (options.publicProjectId) {
        parameters.push(options.publicProjectId);
        conditions += ` AND t.project_id = $${parameters.length} AND p.is_public = true`;
      }
      if (options.version) {
        parameters.push(options.version);
        conditions += ` AND t.xmin::text = $${parameters.length}`;
      }
      const [row] = (await tx.query(
        `SELECT ${chunkOf("t.description")} AS content, t.xmin::text AS version
         FROM task t INNER JOIN project p ON p.id = t.project_id
         WHERE ${conditions} LIMIT 1`,
        parameters,
      )) as PageRow[];
      return toPage(row, options);
    });
  }

  getPublicProjectDescriptionPage(
    projectId: string,
    options: DescriptionPageOptions,
  ) {
    return boundedTaskRead(this.dataSource, async (tx) => {
      const parameters: unknown[] = [options.offset + 1, projectId];
      let conditions = "p.id = $2 AND p.is_public = true";
      if (options.version) {
        parameters.push(options.version);
        conditions += ` AND p.xmin::text = $${parameters.length}`;
      }
      const [row] = (await tx.query(
        `SELECT ${chunkOf("p.description")} AS content, p.xmin::text AS version
         FROM project p WHERE ${conditions} LIMIT 1`,
        parameters,
      )) as PageRow[];
      return toPage(row, options);
    });
  }

  /** Tasks whose list summary omits a description that contains `query`. */
  getDeferredDescriptionMatches(
    projectId: string,
    query: string,
    after?: string,
  ) {
    return boundedTaskRead(this.dataSource, async (tx) => {
      const parameters: unknown[] = [projectId, query];
      if (after) parameters.push(after);
      const rows = (await tx.query(
        `SELECT id FROM task
         WHERE project_id = $1
           AND ${descriptionDeferredSql("description")}
           AND strpos(lower(description), lower($2)) > 0
           ${after ? "AND id > $3" : ""}
         ORDER BY id ASC
         LIMIT ${DESCRIPTION_MATCH_PAGE_SIZE + 1}`,
        parameters,
      )) as { id: string }[];
      const matches = rows.slice(0, DESCRIPTION_MATCH_PAGE_SIZE);
      return {
        ids: matches.map((row) => row.id),
        nextCursor:
          rows.length > DESCRIPTION_MATCH_PAGE_SIZE
            ? (matches.at(-1)?.id ?? null)
            : null,
      };
    });
  }
}
