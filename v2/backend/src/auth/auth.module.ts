import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AccountController } from "./account/account.controller";
import { AccountService } from "./account/account.service";
import { AnonymousController } from "./anonymous/anonymous.controller";
import { AnonymousSignInService } from "./anonymous/anonymous-sign-in.service";
import { GuestAccountLinking } from "./anonymous/guest-account-linking.service";
import { ApiKeyModule } from "./api-key/api-key.module";
import { AuthGuard } from "./auth.guard";
import { Authenticator } from "./authenticator";
import { DeleteUserModule } from "./delete-user/delete-user.module";
import { DeviceAuthModule } from "./device/device-auth.module";
import { OidcModule } from "./oidc/oidc.module";
import { SocialAuthModule } from "./social/social-auth.module";
import { EmailPasswordController } from "./email-password/email-password.controller";
import { SignInService } from "./email-password/sign-in.service";
import { SignUpService } from "./email-password/sign-up.service";
import { EmailOtpController } from "./email-otp/email-otp.controller";
import { EmailOtpService } from "./email-otp/email-otp.service";
import { OtpCodes } from "./email-otp/otp-codes.service";
import { InstanceBootstrapService } from "./instance/instance-bootstrap.service";
import { MagicLinkController } from "./magic-link/magic-link.controller";
import { MagicLinkService } from "./magic-link/magic-link.service";
import { PasswordService } from "./password/password.service";
import { PasswordResetController } from "./password-reset/password-reset.controller";
import { PasswordResetService } from "./password-reset/password-reset.service";
import { RequestAuthenticator } from "./request-authenticator";
import { CurrentSessionService } from "./sessions/current-session.service";
import { SessionController } from "./sessions/session.controller";
import { SessionService } from "./sessions/session.service";
import { SessionEligibilityService } from "./sign-in-policy/session-eligibility.service";
import { UserRegistrationService } from "./sign-in-policy/user-registration.service";
import { AccessTokenService } from "./tokens/access-token.service";
import { VerificationStore } from "./verification/verification-store.service";

const shared = [
  AccessTokenService,
  CurrentSessionService,
  InstanceBootstrapService,
  PasswordService,
  SessionService,
  GuestAccountLinking,
  VerificationStore,
  UserRegistrationService,
  SessionEligibilityService,
];

@Global()
@Module({
  // Keys and lifetimes are passed per call, so they follow the environment.
  imports: [
    JwtModule.register({}),
    ApiKeyModule,
    SocialAuthModule,
    OidcModule,
    DeviceAuthModule,
    DeleteUserModule,
  ],
  controllers: [
    SessionController,
    EmailPasswordController,
    AccountController,
    PasswordResetController,
    EmailOtpController,
    MagicLinkController,
    AnonymousController,
  ],
  providers: [
    ...shared,
    AccountService,
    SignInService,
    SignUpService,
    PasswordResetService,
    OtpCodes,
    EmailOtpService,
    MagicLinkService,
    AnonymousSignInService,
    RequestAuthenticator,
    { provide: Authenticator, useExisting: RequestAuthenticator },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [...shared, Authenticator, ApiKeyModule],
})
export class AuthModule {}
