import mongoose from "mongoose";

/** Cached connection for serverless / multi-invoke hosts (Vercel, etc.). */
let cached = globalThis.__queueitMongoose;
if (!cached) {
  cached = globalThis.__queueitMongoose = { conn: null, promise: null };
}

/**
 * Connect mongoose to the given URI (or process.env.MONGODB_URI).
 * Safe to call once at process start; tests pass an in-memory URI.
 * Reuses an in-flight or established connection when hosts reuse the process.
 */
export async function connectDb(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    mongoose.set("strictQuery", true);
    cached.promise = mongoose.connect(uri).then((m) => m.connection);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export async function disconnectDb() {
  cached.conn = null;
  cached.promise = null;
  await mongoose.disconnect();
}
