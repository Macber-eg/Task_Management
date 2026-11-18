import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import { AllExceptionsFilter } from "./errors/all-exceptions.filter";
import { OpenApiController } from "./openapi/openapi.controller";
import { OpenApiDocumentService } from "./openapi/openapi-document.service";
import { RouteInputInterceptor } from "./openapi/route-input.interceptor";

@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [OpenApiController],
  providers: [
    OpenApiDocumentService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RouteInputInterceptor },
  ],
  exports: [OpenApiDocumentService],
})
export class CommonModule {}
