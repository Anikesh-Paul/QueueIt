/**
 * Whether the process should upsert demo accounts + venue/queues after DB connect.
 * Controlled by SEED_ON_BOOT env (host dashboard only — never commit secrets).
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {boolean}
 */
export function shouldSeedOnBoot(env = process.env) {
  const v = (env.SEED_ON_BOOT || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
