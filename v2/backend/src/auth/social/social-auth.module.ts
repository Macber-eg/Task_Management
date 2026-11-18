import { Module } from "@nestjs/common";
import { OAuthStateService } from "../oauth-state/oauth-state.service";
import { OAuthAccountLinkService } from "./oauth-account-link.service";
import { OAuthRegistrationService } from "./oauth-registration.service";
import { OAuthSessionStarter } from "./oauth-session-starter.service";
import { OAuthSignInService } from "./oauth-sign-in.service";
import { SocialProviderEndpoints } from "./providers/social-provider-endpoints";
import { SocialAuthorizationService } from "./social-authorization.service";
import { SocialCallbackService } from "./social-callback.service";
import { SocialProviders } from "./social-providers";
import { SocialController } from "./social.controller";

/** The OAuth plumbing every provider flow shares. */
const shared = [
  OAuthStateService,
  OAuthSignInService,
  OAuthAccountLinkService,
  OAuthSessionStarter,
];

/** Sign-in and account linking with GitHub, Google, Discord (and `custom`). */
@Module({
  controllers: [SocialController],
  providers: [
    ...shared,
    OAuthRegistrationService,
    SocialProviderEndpoints,
    SocialProviders,
    SocialAuthorizationService,
    SocialCallbackService,
  ],
  exports: shared,
})
export class SocialAuthModule {}
