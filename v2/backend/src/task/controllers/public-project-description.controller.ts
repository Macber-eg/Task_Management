import { Controller } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { DescriptionPageService } from "../queries/description-page.service";
import {
  getPublicProjectDescriptionPageRoute,
  getPublicTaskDescriptionPageRoute,
} from "../routes/public-project-description.routes";

/** Description pages of public boards, readable without signing in. */
@Controller("public-project")
export class PublicProjectDescriptionController {
  constructor(private readonly descriptions: DescriptionPageService) {}

  @Public()
  @ApiRoute(getPublicProjectDescriptionPageRoute)
  getPublicProjectDescriptionPage(
    @Input() input: RouteInput<typeof getPublicProjectDescriptionPageRoute>,
  ) {
    return this.descriptions.getPublicProjectDescriptionPage(
      input.param.id,
      input.query,
    );
  }

  @Public()
  @ApiRoute(getPublicTaskDescriptionPageRoute)
  getPublicTaskDescriptionPage(
    @Input() input: RouteInput<typeof getPublicTaskDescriptionPageRoute>,
  ) {
    return this.descriptions.getDescriptionPage(input.param.taskId, {
      ...input.query,
      publicProjectId: input.param.id,
    });
  }
}
