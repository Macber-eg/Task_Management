import { resolve } from "node:path";
import { config } from "dotenv";
import { resolveDatabaseConnectionString } from "../../src/database/resolve-database-url";
import { testDatabaseUrl } from "./test-database-url";

// Same reason as `src/config/load-env.ts`: timestamp columns hold UTC.
process.env.TZ = "UTC";

config({ path: resolve(__dirname, "../../.env"), quiet: true });

process.env.DATABASE_URL = testDatabaseUrl(resolveDatabaseConnectionString());
