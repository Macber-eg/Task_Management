import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createId } from "@paralleldrive/cuid2";
import { Repository } from "typeorm";
import { UserAvatarEntity } from "../database/entities/user-avatar.entity";
import { buildAvatarUrl, decodeAvatarUpload } from "./avatar";

export type StoredAvatar = Pick<
  UserAvatarEntity,
  "id" | "mimeType" | "size" | "data" | "updatedAt"
>;

@Injectable()
export class AvatarService {
  constructor(
    @InjectRepository(UserAvatarEntity)
    private readonly avatars: Repository<UserAvatarEntity>,
  ) {}

  async saveAvatar({
    userId,
    contentType,
    data,
  }: {
    userId: string;
    contentType: string;
    data: string;
  }) {
    const { mimeType, bytes } = decodeAvatarUpload({ contentType, data });

    // A replacement takes a new id: the public URL is cached as immutable.
    const [saved] = (await this.avatars.query(
      `INSERT INTO user_avatar (id, user_id, mime_type, size, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET id = EXCLUDED.id,
             mime_type = EXCLUDED.mime_type,
             size = EXCLUDED.size,
             data = EXCLUDED.data,
             updated_at = $6
       RETURNING id`,
      [createId(), userId, mimeType, bytes.length, bytes, new Date()],
    )) as { id: string }[];

    if (!saved) {
      throw new Error("Failed to store avatar");
    }

    return { id: saved.id, url: buildAvatarUrl(saved.id), size: bytes.length };
  }

  async deleteAvatar(userId: string) {
    const result = await this.avatars.delete({ userId });
    return { deleted: (result.affected ?? 0) > 0 };
  }

  getAvatar(id: string): Promise<StoredAvatar | null> {
    return this.avatars.findOne({
      where: { id },
      select: {
        id: true,
        mimeType: true,
        size: true,
        data: true,
        updatedAt: true,
      },
    });
  }
}
