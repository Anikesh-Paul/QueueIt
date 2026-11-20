/**
 * Staff handover notes: short messages left at a queue or counter for the
 * next person on shift. Scoped to the same venues the author can manage.
 */
import mongoose from "mongoose";
import { HandoverNote, HANDOVER_BODY_MAX, HANDOVER_PREVIEW_MAX } from "../models/HandoverNote.js";
import { Queue } from "../models/Queue.js";
import { Venue } from "../models/Venue.js";
import { now as clockNow } from "./clock.js";
import { findCounter } from "./counters.js";
import { orgIdOfVenue } from "./organizations.js";
import { canAccessQueue } from "./staffAccess.js";

export const NOTE_BODY_MAX = HANDOVER_BODY_MAX;
export const DEFAULT_EXPIRY_HOURS = 24;
export const EXPIRY_HOURS_MIN = 1;
export const EXPIRY_HOURS_MAX = 168;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const EXPIRY_PRESETS = [4, 8, 12, 24, 48, 72, 168];

export class HandoverError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function actorOf(user) {
  if (!user) return { id: null, name: null };
  const id = (user._id ?? user.id)?.toString?.() ?? null;
  return { id, name: user.name || user.email || null };
}

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

export function handoverExpiryHoursOf(queue) {
  const n = Number(queue?.handoverExpiryHours);
  if (Number.isInteger(n) && n >= EXPIRY_HOURS_MIN && n <= EXPIRY_HOURS_MAX) return n;
  return DEFAULT_EXPIRY_HOURS;
}

export function handoverSettingsForJson(queue) {
  return { expiryHours: handoverExpiryHoursOf(queue) };
}

export function applyHandoverSettings(queue, patch = {}) {
  if (patch.handoverExpiryHours === undefined || patch.handoverExpiryHours === null || patch.handoverExpiryHours === "") {
    return {};
  }
  const n = Number(patch.handoverExpiryHours);
  if (!Number.isInteger(n) || n < EXPIRY_HOURS_MIN || n > EXPIRY_HOURS_MAX) {
    return {
      error: `Notes should expire after a whole number of hours from ${EXPIRY_HOURS_MIN} to ${EXPIRY_HOURS_MAX}`,
    };
  }
  queue.handoverExpiryHours = n;
  return {};
}

function stripControlChars(raw) {
  let out = "";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) out += ch;
  }
  return out;
}

/** Strip control characters and HTML tags, then enforce the 500-character cap. */
export function sanitizeNoteBody(raw) {
  if (typeof raw !== "string") {
    throw new HandoverError(400, "Write a short note", "note-invalid");
  }
  const stripped = stripControlChars(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!stripped) throw new HandoverError(400, "Write a short note", "note-empty");
  if (stripped.length > NOTE_BODY_MAX) {
    throw new HandoverError(400, `Keep the note under ${NOTE_BODY_MAX} characters`, "note-too-long");
  }
  return stripped;
}

export function cleanExpiryHours(raw, fallback = DEFAULT_EXPIRY_HOURS) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < EXPIRY_HOURS_MIN || n > EXPIRY_HOURS_MAX) {
    throw new HandoverError(
      400,
      `Notes should expire after a whole number of hours from ${EXPIRY_HOURS_MIN} to ${EXPIRY_HOURS_MAX}`,
      "expiry-invalid"
    );
  }
  return n;
}

function purgeAtFor(expiresAt, resolvedAt, at = clockNow()) {
  const end = resolvedAt && resolvedAt > expiresAt ? resolvedAt : expiresAt;
  const from = end instanceof Date ? end.getTime() : new Date(end).getTime();
  return new Date(Math.max(from, at.getTime()) + RETENTION_MS);
}

export function notePreview(body) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text.length <= HANDOVER_PREVIEW_MAX) return text;
  return `${text.slice(0, HANDOVER_PREVIEW_MAX - 1).trimEnd()}…`;
}

export function noteState(doc, at = clockNow()) {
  if (doc?.resolvedAt) return "resolved";
  if (doc?.expiresAt && new Date(doc.expiresAt).getTime() <= at.getTime()) return "expired";
  return "active";
}

function hasAcked(doc, user) {
  const id = (user?._id ?? user?.id)?.toString?.();
  if (!id || !Array.isArray(doc?.acknowledgedBy)) return false;
  return doc.acknowledgedBy.some((row) => sameId(row.id, id));
}

export function toNoteJSON(doc, { user = null, at = clockNow() } = {}) {
  const state = noteState(doc, at);
  return {
    id: String(doc._id),
    body: doc.body,
    queueId: doc.queue ? String(doc.queue._id ?? doc.queue) : null,
    venueId: doc.venue ? String(doc.venue._id ?? doc.venue) : null,
    organizationId: doc.organizationId || "default",
    counterId: doc.counter ? String(doc.counter) : null,
    counterName: doc.counterName || null,
    author: doc.author?.id ? { id: doc.author.id, name: doc.author.name || null } : null,
    important: Boolean(doc.important),
    pinned: Boolean(doc.pinned),
    state,
    resolvedAt: doc.resolvedAt ? new Date(doc.resolvedAt).toISOString() : null,
    resolvedBy: doc.resolvedBy?.id ? { id: doc.resolvedBy.id, name: doc.resolvedBy.name || null } : null,
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
    expiryHours: doc.expiryHours ?? DEFAULT_EXPIRY_HOURS,
    acknowledged: hasAcked(doc, user),
    acknowledgedCount: Array.isArray(doc.acknowledgedBy) ? doc.acknowledgedBy.length : 0,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
  };
}

async function venueOf(queue) {
  if (queue.populated?.("venue") && queue.venue) return queue.venue;
  if (queue.venue && typeof queue.venue === "object" && queue.venue.name != null) return queue.venue;
  return Venue.findById(queue.venue);
}

function assertQueueAccess(user, queue) {
  if (!canAccessQueue(user, queue)) {
    throw new HandoverError(403, "You don't have access to this queue", "forbidden");
  }
}

async function loadNoteOrThrow(queue, noteId) {
  const note = await HandoverNote.findOne({ _id: noteId, queue: queue._id });
  if (!note) throw new HandoverError(404, "Note not found", "not-found");
  return note;
}

/**
 * Active notes first (pinned, then important, then newest), followed by
 * recently resolved or expired ones so staff can still tick them off.
 */
export async function listNotes(user, queue, { at = clockNow() } = {}) {
  assertQueueAccess(user, queue);
  const since = new Date(at.getTime() - RETENTION_MS);
  const notes = await HandoverNote.find({
    queue: queue._id,
    $or: [
      { resolvedAt: null, expiresAt: { $gt: at } },
      { resolvedAt: { $gte: since } },
      { resolvedAt: null, expiresAt: { $gt: since, $lte: at } },
    ],
  }).sort({ pinned: -1, important: -1, createdAt: -1 });
  return {
    notes: notes.map((doc) => toNoteJSON(doc, { user, at })),
    handover: handoverSettingsForJson(queue),
  };
}

export async function listUnreadNotes(user, queue, counterId = null, at = clockNow()) {
  assertQueueAccess(user, queue);
  const userId = (user._id ?? user.id)?.toString?.();
  const filter = {
    queue: queue._id,
    resolvedAt: null,
    expiresAt: { $gt: at },
    "acknowledgedBy.id": { $ne: userId },
  };
  if (counterId) {
    filter.$or = [{ counter: null }, { counter: counterId }];
  }
  const notes = await HandoverNote.find(filter).sort({ pinned: -1, important: -1, createdAt: -1 });
  return notes.map((doc) => toNoteJSON(doc, { user, at }));
}

export async function countsByQueue(queueIds, at = clockNow()) {
  if (!queueIds?.length) return new Map();
  const rows = await HandoverNote.aggregate([
    { $match: { queue: { $in: queueIds }, resolvedAt: null, expiresAt: { $gt: at } } },
    { $group: { _id: "$queue", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.n]));
}

/** Add active-note counts and unread shift notes to a shift board payload. */
export async function attachHandoverToBoard(board, user, at = clockNow()) {
  if (!board) return board;
  const objectIds = (board.queues || [])
    .map((row) => row.id)
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const counts = await countsByQueue(objectIds, at);
  for (const row of board.queues || []) {
    row.activeNotes = counts.get(String(row.id)) || 0;
  }
  if (board.me) {
    const queue = await Queue.findById(board.me.queue.id);
    board.unreadNotes = queue ? await listUnreadNotes(user, queue, board.me.counter.id, at) : [];
  } else {
    board.unreadNotes = [];
  }
  return board;
}

export async function createHandoverNote(user, queue, input = {}, at = clockNow()) {
  assertQueueAccess(user, queue);
  const body = sanitizeNoteBody(input.body);
  const hours = cleanExpiryHours(input.expiresInHours, handoverExpiryHoursOf(queue));
  let counter = null;
  let counterName = null;
  if (input.counterId) {
    counter = findCounter(queue, input.counterId);
    if (!counter) throw new HandoverError(404, "Counter not found", "counter-not-found");
    counterName = counter.name || null;
  }
  const venue = await venueOf(queue);
  if (!venue) throw new HandoverError(500, "This queue has no venue", "no-venue");
  const expiresAt = new Date(at.getTime() + hours * 60 * 60 * 1000);
  const doc = await HandoverNote.create({
    body,
    queue: queue._id,
    venue: venue._id,
    organizationId: orgIdOfVenue(venue),
    counter: counter?._id || null,
    counterName,
    author: actorOf(user),
    important: Boolean(input.important),
    pinned: Boolean(input.pinned),
    expiresAt,
    expiryHours: hours,
    acknowledgedBy: [],
    purgeAt: purgeAtFor(expiresAt, null, at),
  });
  return doc;
}

export async function updateHandoverNote(user, queue, noteId, input = {}) {
  assertQueueAccess(user, queue);
  const note = await loadNoteOrThrow(queue, noteId);
  const changed = [];
  if (input.pinned !== undefined) {
    const next = Boolean(input.pinned);
    if (next !== Boolean(note.pinned)) {
      note.pinned = next;
      changed.push(next ? "pinned" : "unpinned");
    }
  }
  if (input.important !== undefined) {
    const next = Boolean(input.important);
    if (next !== Boolean(note.important)) {
      note.important = next;
      changed.push(next ? "flagged" : "unflagged");
    }
  }
  if (changed.length) await note.save();
  return { note, changed };
}

export async function acknowledgeNote(user, queue, noteId, at = clockNow()) {
  assertQueueAccess(user, queue);
  const note = await loadNoteOrThrow(queue, noteId);
  if (hasAcked(note, user)) return { note, changed: false };
  note.acknowledgedBy.push({ ...actorOf(user), at });
  await note.save();
  return { note, changed: true };
}

export async function resolveNote(user, queue, noteId, at = clockNow()) {
  assertQueueAccess(user, queue);
  const note = await loadNoteOrThrow(queue, noteId);
  if (note.resolvedAt) return { note, changed: false };
  note.resolvedAt = at;
  note.resolvedBy = actorOf(user);
  note.purgeAt = purgeAtFor(note.expiresAt, at, at);
  await note.save();
  return { note, changed: true };
}
