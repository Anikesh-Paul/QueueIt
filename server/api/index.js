/**
 * Vercel serverless entry (project root = server/).
 * Connects MongoDB (cached), optional SEED_ON_BOOT, exports Express app.
 */
import "dotenv/config";
import { prepareApp } from "../src/bootstrap.js";

const appPromise = prepareApp();

export default async function handler(req, res) {
  const app = await appPromise;
  return app(req, res);
}
