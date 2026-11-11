import { createApp } from "./app.js";
import { connectDb } from "./db.js";
import { QueueEntry } from "./models/QueueEntry.js";
import { Guest } from "./models/Guest.js";
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
  // Ensure unique partial indexes exist (autoIndex is off in production).
  await QueueEntry.createIndexes();
  await Guest.createIndexes();
  await Guest.migrateLegacyPlaintextCredentials();

  if (shouldSeedOnBoot() && !globalThis.__queueitSeeded) {
    await seedAll();
    globalThis.__queueitSeeded = true;
  }

  return createApp();
}
