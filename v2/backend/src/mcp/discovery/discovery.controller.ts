import { Controller, Get } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./discovery-documents";
import {
  AUTHORIZATION_SERVER_PATH,
  PROTECTED_RESOURCE_PATH,
} from "./discovery-routes";
import { publicBaseUrl } from "./public-base-url";

/** OAuth discovery for MCP clients, at `/.well-known/…` and `/api/.well-known/…`. */
@Public()
@Controller()
export class McpDiscoveryController {
  @Get([PROTECTED_RESOURCE_PATH, `api/${PROTECTED_RESOURCE_PATH}`])
  protectedResource() {
    return protectedResourceMetadata(publicBaseUrl());
  }

  @Get([AUTHORIZATION_SERVER_PATH, `api/${AUTHORIZATION_SERVER_PATH}`])
  authorizationServer() {
    return authorizationServerMetadata(publicBaseUrl());
  }
}
