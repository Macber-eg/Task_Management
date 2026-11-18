import { Module } from "@nestjs/common";
import { AdminModule } from "../../admin/admin.module";
import { DeleteUserController } from "./delete-user.controller";
import { DeleteUserService } from "./delete-user.service";

/** `POST /api/auth/delete-user`; the workspace clean-up is the admin module's. */
@Module({
  imports: [AdminModule],
  controllers: [DeleteUserController],
  providers: [DeleteUserService],
})
export class DeleteUserModule {}
