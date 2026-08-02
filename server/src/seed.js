import { User } from "./models/User.js";

/**
 * Upsert demo user + admin from environment variables.
 * Passwords come only from env (never committed secrets).
 *
 * Required env (when seeding):
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *   SEED_USER_EMAIL, SEED_USER_PASSWORD
 */
export async function seedDemoAccounts(env = process.env) {
  const adminEmail = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = env.SEED_ADMIN_PASSWORD;
  const userEmail = env.SEED_USER_EMAIL?.trim().toLowerCase();
  const userPassword = env.SEED_USER_PASSWORD;

  if (!adminEmail || !adminPassword || !userEmail || !userPassword) {
    throw new Error(
      "Seed requires SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_USER_EMAIL, SEED_USER_PASSWORD"
    );
  }

  await upsertAccount({
    email: adminEmail,
    password: adminPassword,
    name: env.SEED_ADMIN_NAME || "Demo Admin",
    role: "admin",
  });

  await upsertAccount({
    email: userEmail,
    password: userPassword,
    name: env.SEED_USER_NAME || "Demo User",
    role: "user",
  });

  return {
    adminEmail,
    userEmail,
  };
}

async function upsertAccount({ email, password, name, role }) {
  const passwordHash = await User.hashPassword(password);
  const existing = await User.findOne({ email }).select("+passwordHash");

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.name = name;
    existing.role = role;
    await existing.save();
    return existing;
  }

  return User.create({
    email,
    name,
    passwordHash,
    role,
  });
}
