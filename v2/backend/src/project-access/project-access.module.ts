import { Module } from "@nestjs/common";
import { AccessChangeLock } from "./access-change-lock";
import { HiddenGrantsService } from "./hidden-grants.service";
import { ProjectAccessRequestService } from "./project-access-request.service";

const providers = [
  AccessChangeLock,
  HiddenGrantsService,
  ProjectAccessRequestService,
];

@Module({ providers, exports: providers })
export class ProjectAccessModule {}
