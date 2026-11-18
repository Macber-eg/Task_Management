import { Controller, Headers, Res } from "@nestjs/common";
import type { Response } from "express";
import { UserId } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { HTTPException } from "../common/errors/http-exception";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { AvatarService } from "./avatar.service";
import { CurrentUserService } from "./current-user.service";
import {
  deleteAvatarRoute,
  getCurrentUserRoute,
  getUserAvatarRoute,
  uploadAvatarRoute,
} from "./user.routes";

@Controller("user")
export class UserController {
  constructor(
    private readonly currentUser: CurrentUserService,
    private readonly avatars: AvatarService,
  ) {}

  // Written to the response directly: the body is raw bytes, and Express's
  // own send() would also answer 304 to If-Modified-Since.
  @Public()
  @ApiRoute(getUserAvatarRoute)
  async getAvatar(
    @Input() input: RouteInput<typeof getUserAvatarRoute>,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const avatar = await this.avatars.getAvatar(input.param.id);

    if (!avatar) {
      throw new HTTPException(404, { message: "Avatar not found" });
    }

    const etag = `"${avatar.id}"`;
    if (ifNoneMatch === etag) {
      response.status(304).set("ETag", etag).end();
      return;
    }

    response
      .status(200)
      .set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": avatar.size.toString(),
        "Content-Type": avatar.mimeType,
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
        "Last-Modified": avatar.updatedAt.toUTCString(),
      })
      .end(avatar.data);
  }

  @ApiRoute(getCurrentUserRoute)
  getCurrentUser(@UserId() userId: string) {
    return this.currentUser.getCurrentUser(userId);
  }

  @ApiRoute(uploadAvatarRoute)
  async uploadAvatar(
    @Input() input: RouteInput<typeof uploadAvatarRoute>,
    @UserId() userId: string,
  ) {
    const { contentType, data } = input.json;
    try {
      return await this.avatars.saveAvatar({ userId, contentType, data });
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "Invalid avatar upload",
      });
    }
  }

  @ApiRoute(deleteAvatarRoute)
  deleteAvatar(@UserId() userId: string) {
    return this.avatars.deleteAvatar(userId);
  }
}
