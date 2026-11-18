import { Module } from "@nestjs/common";
import { SocialAuthModule } from "../social/social-auth.module";
import { OidcAuthorizationService } from "./oidc-authorization.service";
import { OidcCallbackService } from "./oidc-callback.service";
import { OidcController } from "./oidc.controller";

/** Sign-in with the generic OIDC/OAuth2 provider configured as `custom`. */
@Module({
  imports: [SocialAuthModule],
  controllers: [OidcController],
  providers: [OidcAuthorizationService, OidcCallbackService],
})
export class OidcModule {}
