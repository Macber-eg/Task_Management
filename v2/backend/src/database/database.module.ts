import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { buildDataSourceOptions } from "./data-source-options";
import { ALL_ENTITIES } from "./entities";
import { UtcSelfTest } from "./utc-self-test";

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        migrationsRun: true,
        // The database may still be starting when the API does.
        retryAttempts: 30,
        retryDelay: 1_000,
      }),
    }),
    TypeOrmModule.forFeature([...ALL_ENTITIES]),
  ],
  providers: [UtcSelfTest],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
