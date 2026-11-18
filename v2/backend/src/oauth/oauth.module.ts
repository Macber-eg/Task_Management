import { Module } from "@nestjs/common";
import { IdTokenService } from "./id-token.service";
import { OAuthController } from "./oauth.controller";

@Module({
  controllers: [OAuthController],
  providers: [IdTokenService],
})
export class OAuthModule {}
