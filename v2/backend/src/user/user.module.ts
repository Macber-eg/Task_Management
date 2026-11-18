import { Module } from "@nestjs/common";
import { AvatarService } from "./avatar.service";
import { CurrentUserService } from "./current-user.service";
import { UserController } from "./user.controller";

@Module({
  controllers: [UserController],
  providers: [CurrentUserService, AvatarService],
})
export class UserModule {}
