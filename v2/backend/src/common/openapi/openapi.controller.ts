import { Controller, Get } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { OpenApiDocumentService } from "./openapi-document.service";

@Controller("openapi")
export class OpenApiController {
  constructor(private readonly documents: OpenApiDocumentService) {}

  @Public()
  @Get()
  getDocument() {
    return this.documents.build();
  }
}
