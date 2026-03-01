/**
 * One-shot DB bootstrap for production operations.
 * Creates legacy base schema and applies versioned migrations.
 */
import { getDatabase, initDatabase } from '../database.js';

async function main(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  console.info(`[db:init] Database schema ready (dialect=${db.dialect}).`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db:init] Failed: ${message}`);
    process.exit(1);
  });
