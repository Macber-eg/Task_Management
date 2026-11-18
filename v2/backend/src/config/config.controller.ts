import { Controller } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { ApiRoute } from "../common/openapi";
import { getConfigRoute } from "./config.routes";
import { getSettings } from "./get-settings";

@Controller("config")
export class ConfigController {
  // Public: the login screen reads it to decide which sign-in methods to render.
  @Public()
  @ApiRoute(getConfigRoute)
  getConfig() {
    return getSettings();
  }
}
