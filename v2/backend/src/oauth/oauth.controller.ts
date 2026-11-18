import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireUserSession } from "../access/require-user-session";
import { UserId } from "../auth/current-user.decorator";
import { ApiRoute } from "../common/openapi";
import { IdTokenService } from "./id-token.service";
import { getIdTokenRoute } from "./oauth.routes";

@Controller("oauth")
export class OAuthController {
  constructor(private readonly idTokens: IdTokenService) {}

  @ApiRoute(getIdTokenRoute)
  @Access(requireUserSession())
  getIdToken(@UserId() userId: string) {
    return this.idTokens.getIdToken(userId);
  }
}
