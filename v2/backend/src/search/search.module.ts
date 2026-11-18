import { Module } from "@nestjs/common";
import { GlobalSearchService } from "./global-search.service";
import { SearchController } from "./search.controller";

@Module({
  controllers: [SearchController],
  providers: [GlobalSearchService],
})
export class SearchModule {}
