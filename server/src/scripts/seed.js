/**
 * CLI: seed demo accounts + venue/queues into MongoDB.
 * Usage (from repo root): npm run seed -w server
 * Requires server/.env with MONGODB_URI and SEED_* variables.
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../db.js";
import { seedAll } from "../seed.js";

async function main() {
  await connectDb();
  const result = await seedAll();
  console.log("Seeded demo accounts:");
  console.log(`  admin: ${result.adminEmail}`);
  console.log(`  user:  ${result.userEmail}`);
  console.log("(passwords are only those set in your local .env — not printed)");
  console.log("Seeded venue & queues:");
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
    console.error("Seed failed:", err.message);
    try {
      await disconnectDb();
    } catch {
      // ignore disconnect errors after failure
    }
    process.exit(1);
  });
