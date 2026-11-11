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
function shouldResetCatalog(env = process.env) {
  const v = (env.SEED_RESET_CATALOG || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Upsert one venue and two queues for local/demo use.
 * Idempotent by slug. Re-running does not overwrite live operator or session
 * fields (name, averageServiceTime, noShowMinutes, windows, status,
 * acceptingTokens, sessionEndsAt, reopenAt, counters, maxWaiting) unless
 * SEED_RESET_CATALOG is true.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export async function seedVenueAndQueues(env = process.env) {
  const resetCatalog = shouldResetCatalog(env);
  let venue = await Venue.findOne({ slug: DEMO_VENUE.slug });
  if (venue) {
    if (resetCatalog) {
      venue.name = DEMO_VENUE.name;
      await venue.save();
    }
  } else {
    venue = await Venue.create(DEMO_VENUE);
  }

  const queues = [];
  for (const def of DEMO_QUEUES) {
    let queue = await Queue.findOne({ venue: venue._id, slug: def.slug });
    if (queue) {
      if (resetCatalog) {
        queue.name = def.name;
        queue.averageServiceTime = def.averageServiceTime;
        queue.noShowMinutes = 5;
        queue.serviceWindows = def.serviceWindows;
        queue.status = "open";
        queue.archivedAt = null;
        queue.maxWaiting = null;
      }
      if (!Array.isArray(queue.counters) || queue.counters.length === 0) {
        queue.counters = [{ name: "Counter 1", nowServing: queue.nowServing ?? null }];
      }
      await queue.save();
    } else {
      queue = await Queue.create({
        ...def,
        venue: venue._id,
        status: "open",
        counters: [{ name: "Counter 1", nowServing: null }],
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
  const catalog = await seedVenueAndQueues(env);
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
