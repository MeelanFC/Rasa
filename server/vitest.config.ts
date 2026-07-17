import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    // Every test runs against an isolated in-memory database, never the live file.
    // db.ts's getDb() reads RASA_DB_PATH; combined with the guard in db.ts, no
    // test can touch server/data/rasa.db.
    env: {
      RASA_DB_PATH: ":memory:",
    },
  },
});
