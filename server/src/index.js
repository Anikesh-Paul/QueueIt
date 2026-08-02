import "dotenv/config";
import { prepareApp } from "./bootstrap.js";

const port = Number(process.env.PORT) || 5000;
/** Cloud hosts expect 0.0.0.0; override with HOST if needed. */
const host = process.env.HOST || "0.0.0.0";

async function main() {
  const app = await prepareApp();

  app.listen(port, host, () => {
    console.log(`QueueIt server listening on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err.message || err);
  process.exit(1);
});
