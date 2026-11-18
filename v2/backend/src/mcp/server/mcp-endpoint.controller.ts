import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../auth/public.decorator";
import { McpEndpoint } from "./mcp-endpoint.service";

/** `/api/mcp`: authenticates the bearer token itself, so it is public to the guard. */
@Public()
@Controller("mcp")
export class McpEndpointController {
  constructor(private readonly endpoint: McpEndpoint) {}

  @All()
  handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.endpoint.handle(request, response);
  }
}
