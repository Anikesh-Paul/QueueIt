import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "../models/QueueEntry.js";
import { findActiveEntry } from "./queueStatus.js";

/**
 * Soft upgrade: claim a Guest's memberships + device-local history onto a User,
 * then retire the Guest credential so it no longer powers the device path.
 *
 * Active-membership conflict (User already waiting/serving in the same queue):
 * keep the User's place; reassign the Guest entry as terminal `left` history.
 *
 * @param {import("mongoose").Document} guest — non-retired Guest document
 * @param {import("mongoose").Document} user — target User document
 * @returns {Promise<{ claimed: number }>}
 */
export async function claimGuestOntoUser(guest, user) {
  if (!guest || guest.retiredAt) {
    return { claimed: 0 };
  }

  const entries = await QueueEntry.find({ guest: guest._id });
  let claimed = 0;

  for (const entry of entries) {
    const isActive = ACTIVE_ENTRY_STATUSES.includes(entry.status);
    if (isActive) {
      const userActive = await findActiveEntry(entry.queue, user._id);
      if (userActive && !userActive._id.equals(entry._id)) {
        // Peer fairness: one active membership per queue — keep User place.
        entry.status = "left";
      }
    }

    entry.user = user._id;
    entry.guest = null;
    await entry.save();
    claimed += 1;
  }

  guest.retiredAt = new Date();
  await guest.save();

  return { claimed };
}
