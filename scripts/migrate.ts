import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "../src/db/index.js";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
