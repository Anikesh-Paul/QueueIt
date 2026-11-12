/**
 * Appointment slots alongside walk-ins.
 *
 * Slots are cut from the queue's service windows (weekly plan + exception days)
 * in campus time. A booking is checked in from EARLY_CHECKIN_MINUTES before its
 * slot until slot start + grace; after that it is marked missed. Checked-in
 * bookings become QueueEntry rows in the appointment lane (see priorityLane).
 */
import { Appointment, ACTIVE_APPOINTMENT_STATUSES } from "../models/Appointment.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry, isDuplicateKeyError } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { emitQueueChanged } from "./realtime.js";
import {
  campusDateString,
  campusLocalToUtc,
  getCampusParts,
  parseCampusDate,
  windowsStartingOnDay,
} from "./serviceWindows.js";

export const SLOT_MINUTES_MIN = 5;
export const SLOT_MINUTES_MAX = 120;
export const SLOT_CAPACITY_MIN = 1;
export const SLOT_CAPACITY_MAX = 20;
export const SLOT_GRACE_MIN = 0;
export const SLOT_GRACE_MAX = 30;
export const BOOKING_HORIZON_DAYS = 7;
export const EARLY_CHECKIN_MINUTES = 15;
/** Missed bookings within MISSED_WINDOW_DAYS that pause new bookings. */
export const MISSED_LIMIT = 2;
export const MISSED_WINDOW_DAYS = 14;
export const BOOKING_PAUSE_DAYS = 7;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const BOOKING_ERRORS = {
  disabled: "This queue does not take bookings",
  guest: "Sign in to book a time",
  role: "Staff accounts cannot book a time",
  noSlot: "That time is not available",
  full: "That time is fully booked",
  past: "That time has already started",
  duplicate: "You already have a booking at this queue",
  paused: "Bookings are paused for you after missed slots. Try again later or join the walk-in line.",
  notFound: "Booking not found",
  notActive: "This booking is no longer active",
  tooEarly: "Check-in opens 15 minutes before your time",
  tooLate: "Your booking time has passed",
  inLine: "You are already in this line",
};

function intIn(raw, min, max, label) {
  if (raw === "" || raw == null) return { omitted: true };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${label} must be a whole number from ${min} to ${max}` };
  }
  return { value: n };
}

export const cleanSlotMinutes = (raw) => intIn(raw, SLOT_MINUTES_MIN, SLOT_MINUTES_MAX, "Slot length");
export const cleanSlotCapacity = (raw) => intIn(raw, SLOT_CAPACITY_MIN, SLOT_CAPACITY_MAX, "People per slot");
export const cleanSlotGrace = (raw) => intIn(raw, SLOT_GRACE_MIN, SLOT_GRACE_MAX, "Grace period");

/** Apply an admin patch of booking settings onto a queue doc. */
export function applyAppointmentSettings(queue, patch = {}) {
  if (patch.appointmentsEnabled !== undefined) {
    if (typeof patch.appointmentsEnabled !== "boolean") {
      return { error: "appointmentsEnabled must be true or false" };
    }
    queue.appointmentsEnabled = patch.appointmentsEnabled;
  }
  const fields = [
    ["slotMinutes", cleanSlotMinutes],
    ["slotCapacity", cleanSlotCapacity],
    ["slotGraceMinutes", cleanSlotGrace],
  ];
  for (const [key, clean] of fields) {
    if (patch[key] === undefined) continue;
    const result = clean(patch[key]);
    if (result.error) return { error: result.error };
    if (!result.omitted) queue[key] = result.value;
  }
  return { ok: true };
}

export function slotMinutesOf(queue) {
  const n = Number(queue?.slotMinutes);
  return Number.isInteger(n) && n >= SLOT_MINUTES_MIN ? Math.min(SLOT_MINUTES_MAX, n) : 15;
}
export function slotCapacityOf(queue) {
  const n = Number(queue?.slotCapacity);
  return Number.isInteger(n) && n >= SLOT_CAPACITY_MIN ? Math.min(SLOT_CAPACITY_MAX, n) : 2;
}
export function graceMinutesOf(queue) {
  const n = Number(queue?.slotGraceMinutes);
  return Number.isInteger(n) && n >= 0 ? Math.min(SLOT_GRACE_MAX, n) : 10;
}

function addDays(parts, days) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  base.setUTCDate(base.getUTCDate() + days);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

/** Campus dates (YYYY-MM-DD) that may be booked, today first. */
export function bookableDates(at = clockNow()) {
  const today = getCampusParts(at);
  return Array.from({ length: BOOKING_HORIZON_DAYS }, (_, i) => campusDateString(addDays(today, i)));
}

/**
 * Slot start/end instants for one campus day, cut from the service windows
 * starting that day. A trailing piece shorter than a slot is dropped.
 * @returns {{ start: Date, end: Date }[]}
 */
export function slotsForDay(queue, day) {
  const length = slotMinutesOf(queue);
  const windows = windowsStartingOnDay(queue.serviceWindows, queue.serviceExceptions, day);
  const out = [];
  const seen = new Set();
  for (const w of windows) {
    let end = w.endMinutes;
    if (end <= w.startMinutes) end += 24 * 60; // overnight window
    for (let m = w.startMinutes; m + length <= end; m += length) {
      const start = campusLocalToUtc(day.year, day.month, day.day, 0, 0);
      const startAt = new Date(start.getTime() + m * MINUTE);
      const key = startAt.getTime();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ start: startAt, end: new Date(key + length * MINUTE) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Lazily mark bookings missed once slot start + grace has passed. */
export async function expireMissedAppointments(queue, at = clockNow()) {
  const grace = graceMinutesOf(queue);
  const cutoff = new Date(at.getTime() - grace * MINUTE);
  const res = await Appointment.updateMany(
    { queue: queue._id, status: "booked", slotStart: { $lt: cutoff } },
    { $set: { status: "missed", missedAt: at } }
  );
  if (res.modifiedCount) emitQueueChanged(queue._id, "appointment-missed");
  return res.modifiedCount || 0;
}

/** When a person's bookings are paused after repeated misses, or null. */
export async function bookingPausedUntil(userId, at = clockNow()) {
  const since = new Date(at.getTime() - MISSED_WINDOW_DAYS * DAY);
  const misses = await Appointment.find({ user: userId, status: "missed", missedAt: { $gte: since } })
    .sort({ missedAt: -1 })
    .limit(MISSED_LIMIT)
    .select("missedAt");
  if (misses.length < MISSED_LIMIT) return null;
  const until = new Date(new Date(misses[0].missedAt).getTime() + BOOKING_PAUSE_DAYS * DAY);
  return until > at ? until : null;
}

async function bookedCounts(queueId, from, to) {
  const rows = await Appointment.aggregate([
    {
      $match: {
        queue: queueId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        slotStart: { $gte: from, $lt: to },
      },
    },
    { $group: { _id: "$slotStart", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [new Date(row._id).getTime(), row.count]));
}

export function appointmentSettingsForJson(queue) {
  return {
    enabled: queue.appointmentsEnabled === true,
    slotMinutes: slotMinutesOf(queue),
    slotCapacity: slotCapacityOf(queue),
    graceMinutes: graceMinutesOf(queue),
  };
}

/** Slot grid for one bookable campus date. */
export async function listSlots(queue, rawDate, at = clockNow()) {
  const dates = bookableDates(at);
  const date = rawDate && dates.includes(rawDate) ? rawDate : dates[0];
  const day = parseCampusDate(date);
  const slots = queue.appointmentsEnabled ? slotsForDay(queue, day) : [];
  const capacity = slotCapacityOf(queue);
  const counts = slots.length
    ? await bookedCounts(queue._id, slots[0].start, slots[slots.length - 1].end)
    : new Map();
  return {
    ...appointmentSettingsForJson(queue),
    date,
    dates,
    slots: slots.map((slot) => {
      const booked = counts.get(slot.start.getTime()) || 0;
      const started = slot.start <= at;
      return {
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        booked,
        capacity,
        available: started ? 0 : Math.max(0, capacity - booked),
        state: started ? "past" : booked >= capacity ? "full" : "open",
      };
    }),
  };
}

/** Find the generated slot starting at `startRaw`, or null. */
export function findSlot(queue, startRaw, at = clockNow()) {
  const start = new Date(startRaw);
  if (!startRaw || Number.isNaN(start.getTime())) return null;
  const day = getCampusParts(start);
  const date = campusDateString(day);
  if (!bookableDates(at).includes(date)) return null;
  return slotsForDay(queue, day).find((slot) => slot.start.getTime() === start.getTime()) || null;
}

/** Book a slot for a signed-in user. */
export async function bookSlot(queue, user, startRaw, at = clockNow()) {
  if (!queue.appointmentsEnabled) return { ok: false, status: 409, error: BOOKING_ERRORS.disabled };
  if (user.role !== "user") return { ok: false, status: 403, error: BOOKING_ERRORS.role };
  const slot = findSlot(queue, startRaw, at);
  if (!slot) return { ok: false, status: 400, error: BOOKING_ERRORS.noSlot };
  if (slot.start <= at) return { ok: false, status: 409, error: BOOKING_ERRORS.past };
  const pausedUntil = await bookingPausedUntil(user._id, at);
  if (pausedUntil) {
    return {
      ok: false,
      status: 403,
      error: BOOKING_ERRORS.paused,
      body: { code: "booking-paused", pausedUntil: pausedUntil.toISOString() },
    };
  }
  const capacity = slotCapacityOf(queue);
  const taken = await Appointment.countDocuments({
    queue: queue._id,
    slotStart: slot.start,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
  });
  if (taken >= capacity) return { ok: false, status: 409, error: BOOKING_ERRORS.full };

  let appointment;
  try {
    appointment = await Appointment.create({
      queue: queue._id,
      user: user._id,
      slotStart: slot.start,
      slotMinutes: slotMinutesOf(queue),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return { ok: false, status: 409, error: BOOKING_ERRORS.duplicate };
    throw err;
  }
  // Race guard: if concurrent bookings overfilled the slot, the latest ones back out.
  const holders = await Appointment.find({
    queue: queue._id,
    slotStart: slot.start,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
  })
    .sort({ createdAt: 1, _id: 1 })
    .select("_id");
  const rank = holders.findIndex((row) => row._id.equals(appointment._id));
  if (rank >= capacity) {
    await Appointment.deleteOne({ _id: appointment._id });
    return { ok: false, status: 409, error: BOOKING_ERRORS.full };
  }
  emitQueueChanged(queue._id, "appointment-booked");
  return { ok: true, appointment };
}

export async function cancelBooking(queue, appointment, at = clockNow()) {
  if (appointment.status !== "booked") {
    return { ok: false, status: 409, error: BOOKING_ERRORS.notActive };
  }
  appointment.status = "cancelled";
  appointment.cancelledAt = at;
  await appointment.save();
  emitQueueChanged(queue._id, "appointment-cancelled");
  return { ok: true, appointment };
}

/** Check-in window for a booking: [opensAt, closesAt]. */
export function checkInWindow(queue, appointment) {
  const start = new Date(appointment.slotStart).getTime();
  return {
    opensAt: new Date(start - EARLY_CHECKIN_MINUTES * MINUTE),
    closesAt: new Date(start + graceMinutesOf(queue) * MINUTE),
  };
}

/**
 * Turn a booking into a place in the appointment lane.
 * Staff may check someone in early (they are at the desk) but not after it was missed.
 */
export async function checkInAppointment(queue, appointment, { by = "self", at = clockNow() } = {}) {
  if (appointment.status !== "booked") {
    return { ok: false, status: 409, error: BOOKING_ERRORS.notActive };
  }
  const { opensAt, closesAt } = checkInWindow(queue, appointment);
  if (by === "self" && at < opensAt) {
    return { ok: false, status: 409, error: BOOKING_ERRORS.tooEarly, body: { opensAt: opensAt.toISOString() } };
  }
  if (at > closesAt) {
    appointment.status = "missed";
    appointment.missedAt = at;
    await appointment.save();
    return { ok: false, status: 409, error: BOOKING_ERRORS.tooLate };
  }
  const already = await QueueEntry.findOne({
    queue: queue._id,
    user: appointment.user,
    status: { $in: ["waiting", "serving"] },
  });
  if (already) return { ok: false, status: 409, error: BOOKING_ERRORS.inLine };

  // Claim the booking first so a double tap cannot create two entries.
  const claimed = await Appointment.findOneAndUpdate(
    { _id: appointment._id, status: "booked" },
    { $set: { status: "checked-in", checkedInAt: at, checkedInBy: by } },
    { returnDocument: "after" }
  );
  if (!claimed) return { ok: false, status: 409, error: BOOKING_ERRORS.notActive };

  const bumped = await Queue.findByIdAndUpdate(
    queue._id,
    { $inc: { nextTokenNumber: 1 } },
    { returnDocument: "before" }
  );
  let entry;
  try {
    entry = await QueueEntry.create({
      queue: queue._id,
      user: appointment.user,
      tokenNumber: bumped.nextTokenNumber,
      status: "waiting",
      isWalkIn: false,
      appointment: appointment._id,
      appointmentAt: appointment.slotStart,
    });
  } catch (err) {
    await Appointment.updateOne(
      { _id: appointment._id },
      { $set: { status: "booked", checkedInAt: null, checkedInBy: null } }
    );
    if (isDuplicateKeyError(err)) return { ok: false, status: 409, error: BOOKING_ERRORS.inLine };
    throw err;
  }
  claimed.entry = entry._id;
  await claimed.save();
  emitQueueChanged(queue._id, "appointment-checkin");
  return { ok: true, appointment: claimed, entry };
}

export function toAppointmentJSON(appointment, { queue = null, entry = null, user = null } = {}) {
  const window = queue ? checkInWindow(queue, appointment) : null;
  const json = {
    id: appointment._id.toString(),
    queueId: (appointment.queue?._id ?? appointment.queue).toString(),
    queueName: queue?.name ?? appointment.queue?.name ?? null,
    slotStart: new Date(appointment.slotStart).toISOString(),
    slotEnd: new Date(new Date(appointment.slotStart).getTime() + appointment.slotMinutes * MINUTE).toISOString(),
    status: appointment.status,
    checkedInAt: appointment.checkedInAt ? new Date(appointment.checkedInAt).toISOString() : null,
    checkInOpensAt: window ? window.opensAt.toISOString() : null,
    checkInClosesAt: window ? window.closesAt.toISOString() : null,
    tokenNumber: entry?.tokenNumber ?? null,
    entryStatus: entry?.status ?? null,
  };
  if (user) {
    json.user = { id: user._id.toString(), name: user.name || null, email: user.email || null };
  }
  return json;
}

/** Active bookings for one user across queues (soonest first). */
export async function listMyAppointments(userId, at = clockNow()) {
  const rows = await Appointment.find({
    user: userId,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
  })
    .populate("queue")
    .populate("entry")
    .sort({ slotStart: 1 });
  const out = [];
  for (const row of rows) {
    const queue = row.queue;
    if (!queue || queue.archivedAt) continue;
    if (row.status === "booked") {
      const { closesAt } = checkInWindow(queue, row);
      if (closesAt < at) {
        await expireMissedAppointments(queue, at);
        continue;
      }
    }
    // A checked-in booking stays listed only while its place in line is live.
    if (row.status === "checked-in" && !["waiting", "serving"].includes(row.entry?.status)) continue;
    out.push(toAppointmentJSON(row, { queue, entry: row.entry }));
  }
  return out;
}

/** Bookings on one campus day for the admin console. */
export async function listQueueAppointments(queue, rawDate, at = clockNow()) {
  const dates = bookableDates(at);
  const date = rawDate && parseCampusDate(rawDate) ? rawDate : dates[0];
  const day = parseCampusDate(date);
  const from = campusLocalToUtc(day.year, day.month, day.day, 0, 0);
  const to = new Date(from.getTime() + DAY + 12 * 60 * MINUTE); // include overnight slots
  const rows = await Appointment.find({
    queue: queue._id,
    slotStart: { $gte: from, $lt: to },
    status: { $ne: "cancelled" },
  })
    .populate("user")
    .populate("entry")
    .sort({ slotStart: 1, createdAt: 1 });
  return {
    ...appointmentSettingsForJson(queue),
    date,
    dates,
    appointments: rows.map((row) => toAppointmentJSON(row, { queue, entry: row.entry, user: row.user })),
  };
}
