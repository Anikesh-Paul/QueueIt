import { createApp } from "./app.js";
import { connectDb } from "./db.js";
import { seedAll } from "./seed.js";
import { shouldSeedOnBoot } from "./seedOnBoot.js";

/**
 * Connect DB, optional SEED_ON_BOOT upsert, return a configured Express app.
 * Shared by long-running (index.js) and serverless (api/index.js) entrypoints.
 */
export async function prepareApp() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  await connectDb();

  if (shouldSeedOnBoot() && !globalThis.__queueitSeeded) {
    await seedAll();
    globalThis.__queueitSeeded = true;
  }

  return createApp();
}
