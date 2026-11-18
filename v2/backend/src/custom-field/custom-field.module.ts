import { Module } from "@nestjs/common";
import { CustomFieldController } from "./custom-field.controller";
import { CustomFieldCreationService } from "./custom-field-creation.service";
import { CustomFieldDeletionService } from "./custom-field-deletion.service";
import { CustomFieldQueryService } from "./custom-field-query.service";
import { CustomFieldReorderService } from "./custom-field-reorder.service";
import { CustomFieldValueService } from "./custom-field-value.service";

@Module({
  controllers: [CustomFieldController],
  providers: [
    CustomFieldQueryService,
    CustomFieldCreationService,
    CustomFieldReorderService,
    CustomFieldValueService,
    CustomFieldDeletionService,
  ],
})
export class CustomFieldModule {}
