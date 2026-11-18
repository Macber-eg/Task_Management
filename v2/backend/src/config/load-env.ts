import { resolve } from "node:path";
import { config } from "dotenv";

// Timestamp columns without a time zone hold UTC. Pinning the process zone
// before any Date is created keeps node-postgres and TypeORM from shifting
// them through the server's local time. Must be the first import of every
// entry point.
process.env.TZ = "UTC";

config({ path: resolve(__dirname, "../../.env"), quiet: true });
