import { Controller } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { getPublicProjectRoute } from "./public-project.routes";
import { PublicProjectService } from "./public-project.service";

@Controller("public-project")
export class PublicProjectController {
  constructor(private readonly publicProjects: PublicProjectService) {}

  @Public()
  @ApiRoute(getPublicProjectRoute)
  getPublicProject(@Input() input: RouteInput<typeof getPublicProjectRoute>) {
    return this.publicProjects.getPublicProject(input.param.id, input.query);
  }
}
