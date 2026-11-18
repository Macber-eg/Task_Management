import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AccountController } from "./account/account.controller";
import { AccountService } from "./account/account.service";
import { ApiKeyModule } from "./api-key/api-key.module";
import { AuthGuard } from "./auth.guard";
import { Authenticator } from "./authenticator";
import { EmailPasswordController } from "./email-password/email-password.controller";
import { SignInService } from "./email-password/sign-in.service";
import { SignUpService } from "./email-password/sign-up.service";
import { InstanceBootstrapService } from "./instance/instance-bootstrap.service";
import { PasswordService } from "./password/password.service";
import { RequestAuthenticator } from "./request-authenticator";
import { CurrentSessionService } from "./sessions/current-session.service";
import { SessionController } from "./sessions/session.controller";
import { SessionService } from "./sessions/session.service";
import { AccessTokenService } from "./tokens/access-token.service";

const shared = [
  AccessTokenService,
  CurrentSessionService,
  InstanceBootstrapService,
  PasswordService,
  SessionService,
];

@Global()
@Module({
  // Keys and lifetimes are passed per call, so they follow the environment.
  imports: [JwtModule.register({}), ApiKeyModule],
  controllers: [SessionController, EmailPasswordController, AccountController],
  providers: [
    ...shared,
    AccountService,
    SignInService,
    SignUpService,
    RequestAuthenticator,
    { provide: Authenticator, useExisting: RequestAuthenticator },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [...shared, Authenticator, ApiKeyModule],
})
export class AuthModule {}
