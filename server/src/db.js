import mongoose from "mongoose";

/**
 * Connect mongoose to the given URI (or process.env.MONGODB_URI).
 * Safe to call once at process start; tests pass an in-memory URI.
 */
export async function connectDb(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
