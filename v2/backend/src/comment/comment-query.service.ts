import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

type CommentRow = {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  userName: string;
  userImage: string | null;
};

/** A task's comments with their authors. */
@Injectable()
export class CommentQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async getComments(taskId: string) {
    const comments = (await this.dataSource.query(
      `SELECT a.id, a.task_id AS "taskId", u.id AS "userId", a.content,
              a.created_at AS "createdAt", a.updated_at AS "updatedAt",
              u.name AS "userName", u.image AS "userImage"
       FROM activity AS a
       INNER JOIN "user" AS u ON a.user_id = u.id
       WHERE a.task_id = $1
         AND a.type = 'comment'
         AND a.user_id IS NOT NULL
         AND a.content IS NOT NULL
       ORDER BY a.created_at ASC`,
      [taskId],
    )) as CommentRow[];

    return comments.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      user: {
        name: c.userName,
        image: c.userImage,
      },
    }));
  }
}
