import mongoose from "mongoose";
// Ensure Venue is registered whenever Queue is loaded (needed for populate).
import "./Venue.js";
import { normalizeServiceWindows, normalizeServiceExceptions } from "../services/serviceWindows.js";
import { countersForJson } from "../services/counters.js";

const QUEUE_STATUSES = ["open", "paused"];

const serviceWindowSchema = new mongoose.Schema(
  {
    /** Campus wall time HH:mm (Asia/Kolkata). */
    start: { type: String, required: true, trim: true },
    end: { type: String, required: true, trim: true },
    /**
     * Campus weekdays this window applies (0=Sun … 6=Sat, IST).
     * Missing or empty means every day.
     */
    days: { type: [Number], default: undefined },
  },
  { _id: false }
);

const counterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    nowServing: { type: Number, default: null, min: 1 },
    lastServed: { type: Number, default: null, min: 1 },
  },
  { _id: true }
);

const queueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /** Stable key for idempotent seed upserts within a venue. */
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
      index: true,
    },
    /** Minutes per serve — used later for ETA = position × averageServiceTime. */
    averageServiceTime: {
      type: Number,
      required: true,
      min: 1,
      default: 3,
    },
    status: {
      type: String,
      enum: QUEUE_STATUSES,
      default: "open",
      required: true,
    },
    /**
     * Whether app join may take a Token right now.
     * Orthogonal to status (Paused): Closed = acceptingTokens false; drain continues.
     * Walk-in may still create a membership while not accepting.
     */
    acceptingTokens: {
      type: Boolean,
      default: true,
      required: true,
    },
    /**
     * Service windows (campus IST wall times). Optional `days` scopes a window to weekdays; missing days means every day.
     * Window start does not auto-open; bound session end auto-closes.
     */
    serviceWindows: {
      type: [serviceWindowSchema],
      default: [],
    },
    /**
     * Exception dates (campus IST YYYY-MM-DD). Override weekly windows for that day:
     * closed all day, or alternate hours.
     */
    serviceExceptions: {
      type: [
        new mongoose.Schema(
          {
            date: { type: String, required: true, trim: true },
            closed: { type: Boolean, default: false },
            windows: { type: [serviceWindowSchema], default: undefined },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /**
     * When accepting: absolute instant when auto-close fires (bound target window end,
     * or extended). Null when Closed or no auto-close bound.
     */
    sessionEndsAt: {
      type: Date,
      default: null,
    },
    /**
     * Student-facing reopen guidance when Closed (default next window start, or Admin override).
     */
    reopenAt: {
      type: Date,
      default: null,
    },
    /** Next token to issue on join (monotonic per queue). */
    nextTokenNumber: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    /**
     * Token number currently at the counter (called or just served).
     * null until an admin calls or serves someone.
     */
    nowServing: {
      type: Number,
      default: null,
      min: 1,
    },
    /**
     * Counters at this queue (at least one after ensureDefaultCounters).
     * Each counter's nowServing is the live called token (null when free).
     * lastServed is the last completed serve. queue.nowServing stays the most recent called or served token for compatibility.
     */
    counters: {
      type: [counterSchema],
      default: undefined,
    },
    /** When set, the queue is hidden from the student catalog and new joins are refused. */
    archivedAt: {
      type: Date,
      default: null,
    },
    /**
     * Optional cap on active (waiting + serving) memberships.
     * Missing or null means no cap.
     */
    maxWaiting: {
      type: Number,
      min: 1,
      max: 500,
      default: null,
    },
    /** Minutes a called (serving) entry has to arrive before an auto-skip. */
    noShowMinutes: {
      type: Number,
      min: 1,
      max: 30,
      default: 5,
    },
  },
  { timestamps: true }
);

queueSchema.index({ venue: 1, slug: 1 }, { unique: true });

function toIsoOrNull(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

queueSchema.methods.toPublicJSON = function toPublicJSON() {
  let venue = null;
  if (this.populated("venue") && this.venue) {
    venue = this.venue.toPublicJSON();
  } else if (this.venue) {
    venue = { id: this.venue.toString(), name: null };
  }

  return {
    id: this._id.toString(),
    name: this.name,
    averageServiceTime: this.averageServiceTime,
    noShowMinutes: this.noShowMinutes ?? 5,
    status: this.status,
    acceptingTokens: this.acceptingTokens !== false,
    serviceWindows: normalizeServiceWindows(this.serviceWindows),
    serviceExceptions: normalizeServiceExceptions(this.serviceExceptions),
    sessionEndsAt: toIsoOrNull(this.sessionEndsAt),
    reopenAt: toIsoOrNull(this.reopenAt),
    venue,
    counters: countersForJson(this),
    archived: Boolean(this.archivedAt),
    maxWaiting: this.maxWaiting ?? null,
  };
};

export const Queue = mongoose.models.Queue || mongoose.model("Queue", queueSchema);
export { QUEUE_STATUSES };
