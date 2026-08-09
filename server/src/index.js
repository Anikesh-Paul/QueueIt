import "dotenv/config";
import { createServer } from "node:http";
import { prepareApp } from "./bootstrap.js";
import { createRealtimeServer } from "./realtime.js";
import { parseClientOrigins } from "./corsOrigin.js";

const port = Number(process.env.PORT) || 5000;
/** Cloud hosts expect 0.0.0.0; override with HOST if needed. */
const host = process.env.HOST || "0.0.0.0";

async function main() {
  const app = await prepareApp();

  // Long-running entry: wrap the app in an HTTP server and attach Socket.IO.
  // The Vercel serverless entry (api/index.js) intentionally skips realtime.
  const httpServer = createServer(app);
  createRealtimeServer(httpServer, {
    clientOrigin: parseClientOrigins(process.env.CLIENT_ORIGIN),
  });

  httpServer.listen(port, host, () => {
    console.log(`QueueIt server listening on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err.message || err);
  process.exit(1);
});
