import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { counterState, countersForJson, ensureDefaultCounters, findCounter, staffingFactor } from "./counters.js";
import { isGlobalAdmin, isStaff, staffQueueIds, staffVenueId } from "./staffAccess.js";
import { emitQueueChanged } from "./realtime.js";
import { resolveEtaServicePace } from "./recentServicePace.js";

export const SHIFT_ACTIONS = ["start", "break", "back", "end", "open", "close"];

function sameUser(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/** Queues this console user can see on the shift board. */
async function boardQueues(user) {
  const filter = { archivedAt: null };
  if (isStaff(user)) {
    const venue = staffVenueId(user);
    if (!venue) return [];
    filter.venue = venue;
  } else if (!isGlobalAdmin(user)) {
    return [];
  }
  let queues = await Queue.find(filter).populate("venue").sort({ name: 1 });
  const allowed = staffQueueIds(user);
  if (allowed) queues = queues.filter((q) => allowed.includes(String(q._id)));
  return queues;
}

/** Where this user is on shift right now, if anywhere. */
export async function findMyShift(userId) {
  const queue = await Queue.findOne({ "counters.staffedBy": userId }).populate("venue");
  if (!queue) return null;
  const counter = queue.counters.find((row) => sameUser(row.staffedBy, userId));
  if (!counter) return null;
  return {
    queue: { id: String(queue._id), name: queue.name, venue: queue.venue?.name ?? null },
    counter: { id: String(counter._id), name: counter.name },
    state: counterState(counter),
    since: counter.stateSince ? new Date(counter.stateSince).toISOString() : null,
  };
}

/** Shift board: my shift plus every counter I can manage. */
export async function shiftBoard(user) {
  const queues = await boardQueues(user);
  const ids = queues.map((q) => q._id);
  const waiting = ids.length
    ? await QueueEntry.aggregate([
        { $match: { queue: { $in: ids }, status: "waiting" } },
        { $group: { _id: "$queue", n: { $sum: 1 } } },
      ])
    : [];
  const waitingBy = new Map(waiting.map((row) => [String(row._id), row.n]));
  return {
    me: await findMyShift(user._id),
    queues: await Promise.all(queues.map(async (queue) => {
      ensureDefaultCounters(queue);
      const staffing = staffingFactor(queue);
      const { pace } = await resolveEtaServicePace(queue);
      return {
        id: String(queue._id),
        name: queue.name,
        venue: queue.venue?.name ?? null,
        status: queue.status,
        waiting: waitingBy.get(String(queue._id)) || 0,
        averageServiceTime: queue.averageServiceTime,
        /** Minutes each at today's staffing — the same pace the status page uses. */
        pace: Math.round(pace * staffing.factor * 10) / 10,
        countersOpen: staffing.open,
        countersTotal: staffing.total,
        counters: countersForJson(queue),
      };
    })),
  };
}

/**
 * Apply one shift action to a counter.
 *
 * start  — staff member takes this counter (opens it).
 * break  — staffer steps away; the counter stops taking calls.
 * back   — staffer returns; the counter opens again.
 * end    — staffer leaves; the counter closes.
 * open / close — console user opens or closes an unstaffed counter.
 *
 * @returns {Promise<{ ok: true, queue: object, counter: object, previous: string } | { ok: false, status: number, error: string, code?: string }>}
 */
export async function applyShiftAction(user, queue, counterId, action, { at = clockNow() } = {}) {
  if (!SHIFT_ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: `Action must be one of: ${SHIFT_ACTIONS.join(", ")}` };
  }
  ensureDefaultCounters(queue);
  const counter = findCounter(queue, counterId);
  if (!counter) return { ok: false, status: 404, error: "Counter not found" };

  const previous = counterState(counter);
  const mine = sameUser(counter.staffedBy, user._id);
  const staffedByOther = counter.staffedBy && !mine;
  const otherName = counter.staffedByName || "someone else";

  const busy = await QueueEntry.exists({ queue: queue._id, status: "serving", servingCounterId: counter._id });
  const mustBeFree = () =>
    busy ? { ok: false, status: 409, error: `Serve or skip the person at ${counter.name} first`, code: "counter-busy" } : null;

  if (action === "start") {
    if (staffedByOther) {
      return { ok: false, status: 409, error: `${counter.name} is staffed by ${otherName}`, code: "counter-taken" };
    }
    if (!mine) {
      const current = await findMyShift(user._id);
      if (current) {
        return {
          ok: false,
          status: 409,
          error: `You're on shift at ${current.queue.name} · ${current.counter.name}. End that shift first.`,
          code: "already-on-shift",
        };
      }
    }
    counter.staffedBy = user._id;
    counter.staffedByName = user.name || user.email || null;
    counter.state = "open";
  } else if (action === "break" || action === "back" || action === "end") {
    if (!counter.staffedBy) {
      return { ok: false, status: 409, error: `No one is on shift at ${counter.name}`, code: "not-staffed" };
    }
    if (!mine && !isGlobalAdmin(user)) {
      return { ok: false, status: 403, error: `Only ${otherName} can change this shift` };
    }
    if (action === "break") {
      if (previous === "break") return { ok: true, queue, counter, previous, unchanged: true };
      const blocked = mustBeFree();
      if (blocked) return blocked;
      counter.state = "break";
    } else if (action === "back") {
      if (previous === "open") return { ok: true, queue, counter, previous, unchanged: true };
      counter.state = "open";
    } else {
      const blocked = mustBeFree();
      if (blocked) return blocked;
      counter.state = "closed";
      counter.staffedBy = null;
      counter.staffedByName = null;
    }
  } else {
    if (staffedByOther) {
      return { ok: false, status: 409, error: `${counter.name} is staffed by ${otherName}`, code: "counter-taken" };
    }
    if (action === "close") {
      if (previous === "closed") return { ok: true, queue, counter, previous, unchanged: true };
      const blocked = mustBeFree();
      if (blocked) return blocked;
      counter.state = "closed";
      counter.staffedBy = null;
      counter.staffedByName = null;
    } else {
      if (previous === "open") return { ok: true, queue, counter, previous, unchanged: true };
      counter.state = "open";
    }
  }

  counter.stateSince = at;
  await queue.save();
  emitQueueChanged(queue._id, "counters");
  return { ok: true, queue, counter, previous };
}
