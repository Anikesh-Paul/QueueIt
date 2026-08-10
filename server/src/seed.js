import { User } from "./models/User.js";
import { Venue } from "./models/Venue.js";
import { Queue } from "./models/Queue.js";
import { DEFAULT_SERVICE_WINDOWS } from "./services/serviceWindows.js";

/** Deterministic demo venue + queues (no Super Admin multi-venue UI). */
const DEMO_VENUE = {
  slug: "campus-hub",
  name: "Campus Hub",
};

const DEMO_QUEUES = [
  {
    slug: "cafeteria",
    name: "Cafeteria",
    averageServiceTime: 3,
    serviceWindows: DEFAULT_SERVICE_WINDOWS.cafeteria,
  },
  {
    slug: "gym",
    name: "Gym",
    averageServiceTime: 5,
    serviceWindows: DEFAULT_SERVICE_WINDOWS.gym,
  },
];

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

/**
 * Upsert one venue and two queues for local/demo use.
 * Idempotent by slug; does not introduce multi-venue management UI.
 */
export async function seedVenueAndQueues() {
  let venue = await Venue.findOne({ slug: DEMO_VENUE.slug });
  if (venue) {
    venue.name = DEMO_VENUE.name;
    await venue.save();
  } else {
    venue = await Venue.create(DEMO_VENUE);
  }

  const queues = [];
  for (const def of DEMO_QUEUES) {
    let queue = await Queue.findOne({ venue: venue._id, slug: def.slug });
    if (queue) {
      queue.name = def.name;
      queue.averageServiceTime = def.averageServiceTime;
      queue.serviceWindows = def.serviceWindows;
      queue.status = "open";
      await queue.save();
    } else {
      queue = await Queue.create({
        ...def,
        venue: venue._id,
        status: "open",
      });
    }
    queues.push(queue);
  }

  return {
    venue,
    queues,
  };
}

/**
 * Full local/demo seed: accounts (env) + venue/queues (deterministic).
 */
export async function seedAll(env = process.env) {
  const accounts = await seedDemoAccounts(env);
  const catalog = await seedVenueAndQueues();
  return { ...accounts, ...catalog };
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
