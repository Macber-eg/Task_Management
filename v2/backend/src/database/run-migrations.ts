import "../config/load-env";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { buildDataSourceOptions } from "./data-source-options";

/** Applies pending migrations and exits. The API also does this on startup. */
async function run() {
  const dataSource = new DataSource(buildDataSourceOptions());
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations();
    console.log(
      applied.length
        ? `Applied: ${applied.map((migration) => migration.name).join(", ")}`
        : "No pending migrations.",
    );
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
