import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { connectDb, disconnectDb } from "../src/db.js";

/** @type {MongoMemoryServer | undefined} */
let memoryServer;

/**
 * Start an in-memory MongoDB and connect mongoose. Sets JWT_SECRET for tests.
 * Call once per test file (before).
 */
export async function setupTestDb() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-not-for-production";
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  await connectDb(uri);
}

/** Drop all collections between tests so each case starts clean. */
export async function resetDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

/** Disconnect mongoose and stop the memory server. Call once per test file (after). */
export async function teardownTestDb() {
  await disconnectDb();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
}

/** Fresh Express app bound to the current test DB connection. */
export function testApp() {
  return createApp();
}
