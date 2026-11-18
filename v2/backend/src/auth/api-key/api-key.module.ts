import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { ApiKeyController } from "./api-key.controller";
import { ApiKeyAuthenticator } from "./api-key-authenticator";
import { ApiKeyCreationService } from "./api-key-creation.service";
import { ApiKeyDeletionService } from "./api-key-deletion.service";
import { ApiKeyGetSessionMiddleware } from "./api-key-get-session.middleware";
import { ApiKeyQueryService } from "./api-key-query.service";
import { ApiKeySessionService } from "./api-key-session.service";
import { ApiKeyUpdateService } from "./api-key-update.service";
import { ApiKeyVerifier } from "./api-key-verifier";
import { applyApiKeyHeaders } from "./apply-api-key-headers";
import { AuthRoutesApiKeyMiddleware } from "./auth-routes-api-key.middleware";
import { DatabaseApiKeyAuthenticator } from "./database-api-key-authenticator";
import { ExpiredApiKeyCleanup } from "./expired-api-key-cleanup";

@Module({
  controllers: [ApiKeyController],
  providers: [
    ApiKeyVerifier,
    DatabaseApiKeyAuthenticator,
    { provide: ApiKeyAuthenticator, useExisting: DatabaseApiKeyAuthenticator },
    ApiKeySessionService,
    ExpiredApiKeyCleanup,
    ApiKeyCreationService,
    ApiKeyQueryService,
    ApiKeyUpdateService,
    ApiKeyDeletionService,
  ],
  exports: [ApiKeyAuthenticator],
})
export class ApiKeyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route: any of them may be called with an API key.
    consumer.apply(applyApiKeyHeaders).forRoutes("{*path}");
    consumer
      .apply(AuthRoutesApiKeyMiddleware)
      .forRoutes("auth/{*path}")
      .apply(ApiKeyGetSessionMiddleware)
      .forRoutes(
        { path: "auth/get-session", method: RequestMethod.GET },
        { path: "auth/get-session", method: RequestMethod.POST },
      );
  }
}
