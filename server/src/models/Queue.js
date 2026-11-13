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
    /** When this counter was last auto/explicitly assigned a call. */
    lastAssignedAt: { type: Date, default: null },
    /** open = taking calls; break = staffer stepped away; closed = nobody on it. */
    state: { type: String, enum: ["open", "break", "closed"], default: "open" },
    /** Staff member on shift at this counter (null = unstaffed). */
    staffedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    staffedByName: { type: String, trim: true, maxlength: 80, default: null },
    stateSince: { type: Date, default: null },
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
    /** Minutes a called (serving) entry has to arrive before an auto-skip (fixed mode, or dynamic fallback). */
    noShowMinutes: {
      type: Number,
      min: 1,
      max: 30,
      default: 5,
    },
    /** fixed = use noShowMinutes; dynamic = scale with arrivals, length, and pace, clamped to min/max. */
    noShowMode: {
      type: String,
      enum: ["fixed", "dynamic"],
      default: "fixed",
    },
    /** Lower clamp for a dynamic no-show window. */
    noShowMinMinutes: {
      type: Number,
      min: 1,
      max: 30,
      default: 2,
    },
    /** Upper clamp for a dynamic no-show window. */
    noShowMaxMinutes: {
      type: Number,
      min: 1,
      max: 30,
      default: 15,
    },
    /**
     * When a called person's grace period runs out, call the next person at that
     * counter straight away (only while the counter is open). Off by default.
     */
    noShowAutoCall: { type: Boolean, default: false },
    /** Minutes after a skip during which the student may rejoin once. */
    recoveryMinutes: {
      type: Number,
      min: 1,
      max: 60,
      default: 15,
    },
    /** How many waiting places behind the serving point a recovery is inserted. */
    recoveryPlaces: {
      type: Number,
      min: 1,
      max: 20,
      default: 2,
    },
    /** At most every Kth serve may be a priority entry (1 = no cap). */
    priorityEveryK: {
      type: Number,
      min: 1,
      max: 10,
      default: 3,
    },
    /** Regular serves completed since the last priority serve. Caps at K-1. */
    regularServesSincePriority: {
      type: Number,
      min: 0,
      default: 2,
    },
    /**
     * Allow no-login (Guest) joins from the poster QR / join link. When false,
     * only signed-in users may join; walk-ins are unaffected.
     */
    guestJoin: {
      type: Boolean,
      default: true,
    },
    /** Booked time slots alongside walk-ins. Off by default. */
    appointmentsEnabled: { type: Boolean, default: false },
    /** Slot length in minutes. */
    slotMinutes: { type: Number, min: 5, max: 120, default: 15 },
    /** People who may book the same slot. */
    slotCapacity: { type: Number, min: 1, max: 20, default: 2 },
    /** Minutes after slot start a booking may still check in before it is missed. */
    slotGraceMinutes: { type: Number, min: 0, max: 30, default: 10 },
    /** Walk-in serves since the last booked serve (0 or 1). Booked turns alternate with walk-ins. */
    walkInsSinceAppointment: { type: Number, min: 0, max: 1, default: 1 },
    /** Same-venue group key for equivalent-queue suggestions. Empty means none. */
    equivalentGroup: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null,
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
    noShowMode: this.noShowMode === "dynamic" ? "dynamic" : "fixed",
    noShowMinMinutes: this.noShowMinMinutes ?? 2,
    noShowMaxMinutes: this.noShowMaxMinutes ?? 15,
    noShowAutoCall: this.noShowAutoCall === true,
    recoveryMinutes: this.recoveryMinutes ?? 15,
    recoveryPlaces: this.recoveryPlaces ?? 2,
    priorityEveryK: this.priorityEveryK ?? 3,
    equivalentGroup: this.equivalentGroup || null,
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
    guestJoin: this.guestJoin !== false,
    appointments: {
      enabled: this.appointmentsEnabled === true,
      slotMinutes: this.slotMinutes ?? 15,
      slotCapacity: this.slotCapacity ?? 2,
      graceMinutes: this.slotGraceMinutes ?? 10,
    },
  };
};

export const Queue = mongoose.models.Queue || mongoose.model("Queue", queueSchema);
export { QUEUE_STATUSES };
