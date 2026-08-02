import "dotenv/config";
import { createApp } from "./app.js";
import { connectDb } from "./db.js";

const port = Number(process.env.PORT) || 5000;

async function main() {
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is required. Copy server/.env.example to server/.env");
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is required. Copy server/.env.example to server/.env");
    process.exit(1);
  }

  await connectDb();
  const app = createApp();

  app.listen(port, () => {
    console.log(`QueueIt server listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
