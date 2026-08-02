/**
 * E2E-only seed: wipe then seed the dedicated queueit-e2e database.
 * Never touches the developer DB (queueit).
 *
 * Usage (from repo root): npm run seed:e2e
 * Override URI: MONGODB_URI_E2E=mongodb://127.0.0.1:27017/queueit-e2e
 *
 * Loads server/.env for SEED_* / JWT_SECRET, then forces MONGODB_URI to the e2e DB
 * (dotenv does not override keys we set after config for the wipe target).
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../db.js";
import { seedAll } from "../seed.js";

const E2E_DB_NAME = "queueit-e2e";
const DEFAULT_E2E_URI = `mongodb://127.0.0.1:27017/${E2E_DB_NAME}`;

dotenv.config();

const e2eUri = (process.env.MONGODB_URI_E2E || DEFAULT_E2E_URI).trim();
// Force e2e URI after dotenv so developer queueit from .env is never used here.
process.env.MONGODB_URI = e2eUri;

/**
 * @param {string} uri
 * @returns {string}
 */
function dbNameFromUri(uri) {
  try {
    const u = new URL(uri);
    return u.pathname.replace(/^\//, "").split("/")[0] || "";
  } catch {
    const path = uri.split("?")[0] ?? "";
    const parts = path.split("/");
    return parts[parts.length - 1] || "";
  }
}

/**
 * Guardrail: refuse wipe unless the target is clearly the e2e DB.
 * @param {string} uri
 */
function assertSafeToWipe(uri) {
  const name = dbNameFromUri(uri);
  if (!name || name === "queueit") {
    throw new Error(
      `Refusing to wipe database '${name || "(empty)"}' — e2e seed only targets '${E2E_DB_NAME}' (never developer queueit)`
    );
  }
  if (name !== E2E_DB_NAME && !name.includes("e2e")) {
    throw new Error(
      `Refusing to wipe database '${name}': name must be '${E2E_DB_NAME}' or contain 'e2e'`
    );
  }
}

async function main() {
  assertSafeToWipe(e2eUri);
  console.log(`E2E seed: connecting to ${e2eUri}`);
  await connectDb(e2eUri);
  await mongoose.connection.dropDatabase();
  console.log(`E2E seed: wiped database '${dbNameFromUri(e2eUri)}'`);

  const result = await seedAll(process.env);
  console.log("E2E seed: demo accounts:");
  console.log(`  admin: ${result.adminEmail}`);
  console.log(`  user:  ${result.userEmail}`);
  console.log("(passwords are only those set in your local .env — not printed)");
  console.log("E2E seed: venue & queues:");
  console.log(`  venue: ${result.venue.name}`);
  for (const q of result.queues) {
    console.log(`  queue: ${q.name} (avg ${q.averageServiceTime} min)`);
  }
}

main()
  .then(async () => {
    await disconnectDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("E2E seed failed:", err.message);
    try {
      await disconnectDb();
    } catch {
      // ignore disconnect errors after failure
    }
    process.exit(1);
  });
