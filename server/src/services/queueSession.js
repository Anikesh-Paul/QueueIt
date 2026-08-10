/**
 * Accepting-tokens session: target bind, auto-close, reopen, empty prepare.
 * Lazy evaluation on HTTP paths using the controllable clock seam.
 */

import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import {
  nextWindowStartAfter,
  normalizeServiceWindows,
  resolveTargetWindow,
} from "./serviceWindows.js";
import { emitQueueChanged } from "./realtime.js";

/**
 * @param {import("mongoose").Document} queue
 * @returns {Promise<boolean>} true if waiting list is empty
 */
export async function waitingListIsEmpty(queue) {
  const count = await QueueEntry.countDocuments({
    queue: queue._id,
    status: "waiting",
  });
  return count === 0;
}

/**
 * When Closed and no waiters: prepare next session numbering without accepting.
 * @param {import("mongoose").Document} queue
 */
export async function autoPrepareIfClosedEmpty(queue) {
  if (queue.acceptingTokens !== false) return false;
  const empty = await waitingListIsEmpty(queue);
  if (!empty) return false;
  queue.nextTokenNumber = 1;
  queue.nowServing = null;
  return true;
}

/**
 * If accepting and past sessionEndsAt → Closed + drain + default reopen + maybe prepare.
 * @param {import("mongoose").Document} queue
 * @param {{ emit?: boolean }} [opts]
 * @returns {Promise<boolean>} true if auto-closed this call
 */
export async function ensureQueueSessionState(queue, opts = {}) {
  const shouldEmit = opts.emit !== false;
  if (queue.acceptingTokens === false) {
    return false;
  }
  if (!queue.sessionEndsAt) {
    return false;
  }

  const endsAt = new Date(queue.sessionEndsAt);
  if (Number.isNaN(endsAt.getTime())) {
    return false;
  }

  const instant = clockNow();
  if (instant.getTime() < endsAt.getTime()) {
    return false;
  }

  queue.acceptingTokens = false;
  queue.sessionEndsAt = null;
  const windows = normalizeServiceWindows(queue.serviceWindows);
  queue.reopenAt = nextWindowStartAfter(windows, instant);

  await autoPrepareIfClosedEmpty(queue);
  await queue.save();

  if (shouldEmit) {
    emitQueueChanged(queue._id, "auto-close");
  }
  return true;
}

/**
 * Apply start-accepting: bind target window end, clear reopen.
 * @param {import("mongoose").Document} queue
 * @returns {{ ok: true } | { ok: false, error: string, status: number }}
 */
export function applyStartAccepting(queue) {
  const windows = normalizeServiceWindows(queue.serviceWindows);
  const bound = resolveTargetWindow(windows, clockNow());

  queue.acceptingTokens = true;
  queue.reopenAt = null;

  if (bound) {
    queue.sessionEndsAt = bound.sessionEndsAt;
  } else {
    // No schedule: accept until manual stop (no auto-close).
    queue.sessionEndsAt = null;
  }

  return { ok: true };
}

/**
 * Apply stop-accepting: Closed + drain; default or override reopen.
 * @param {import("mongoose").Document} queue
 * @param {{ reopenAt?: string | Date | null }} [body]
 */
export function applyStopAccepting(queue, body = {}) {
  queue.acceptingTokens = false;
  queue.sessionEndsAt = null;

  if (body.reopenAt != null && body.reopenAt !== "") {
    const override = new Date(body.reopenAt);
    if (Number.isNaN(override.getTime())) {
      return { ok: false, error: "Invalid reopenAt", status: 400 };
    }
    queue.reopenAt = override;
  } else {
    const windows = normalizeServiceWindows(queue.serviceWindows);
    queue.reopenAt = nextWindowStartAfter(windows, clockNow());
  }

  return { ok: true };
}

/**
 * Extend session end while accepting.
 * @param {import("mongoose").Document} queue
 * @param {{ minutes?: number, endsAt?: string | Date }} body
 */
export function applyExtend(queue, body = {}) {
  if (queue.acceptingTokens === false) {
    return {
      ok: false,
      error: "Queue is not accepting tokens",
      status: 409,
    };
  }

  const hasMinutes = body.minutes != null && body.minutes !== "";
  const hasEndsAt = body.endsAt != null && body.endsAt !== "";

  if (hasMinutes && hasEndsAt) {
    return {
      ok: false,
      error: "Provide either minutes or endsAt, not both",
      status: 400,
    };
  }

  if (hasMinutes) {
    const minutes = Number(body.minutes);
    if (![15, 30].includes(minutes)) {
      return {
        ok: false,
        error: "minutes must be 15 or 30",
        status: 400,
      };
    }
    const base = queue.sessionEndsAt
      ? new Date(queue.sessionEndsAt)
      : clockNow();
    queue.sessionEndsAt = new Date(base.getTime() + minutes * 60 * 1000);
    return { ok: true };
  }

  if (hasEndsAt) {
    const endsAt = new Date(body.endsAt);
    if (Number.isNaN(endsAt.getTime())) {
      return { ok: false, error: "Invalid endsAt", status: 400 };
    }
    if (endsAt.getTime() <= clockNow().getTime()) {
      return {
        ok: false,
        error: "endsAt must be in the future",
        status: 400,
      };
    }
    queue.sessionEndsAt = endsAt;
    return { ok: true };
  }

  return {
    ok: false,
    error: "Provide minutes (15|30) or endsAt",
    status: 400,
  };
}

/**
 * ISO helpers for public/admin JSON.
 * @param {Date | string | null | undefined} value
 */
export function toIsoOrNull(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Schedule fields shared by public + admin queue JSON.
 * @param {import("mongoose").Document} queue
 */
export function sessionFieldsForJson(queue) {
  return {
    serviceWindows: normalizeServiceWindows(queue.serviceWindows),
    sessionEndsAt: toIsoOrNull(queue.sessionEndsAt),
    reopenAt: toIsoOrNull(queue.reopenAt),
  };
}
