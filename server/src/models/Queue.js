import mongoose from "mongoose";
// Ensure Venue is registered whenever Queue is loaded (needed for populate).
import "./Venue.js";
import { normalizeServiceWindows } from "../services/serviceWindows.js";

const QUEUE_STATUSES = ["open", "paused"];

const serviceWindowSchema = new mongoose.Schema(
  {
    /** Campus wall time HH:mm (Asia/Kolkata). */
    start: { type: String, required: true, trim: true },
    end: { type: String, required: true, trim: true },
  },
  { _id: false }
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
     * Daily service windows (same pattern every day), campus IST wall times.
     * Window start does not auto-open; bound session end auto-closes.
     */
    serviceWindows: {
      type: [serviceWindowSchema],
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
     * Token number currently at the counter.
     * null until an admin serves someone (ticket 07).
     */
    nowServing: {
      type: Number,
      default: null,
      min: 1,
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
    status: this.status,
    acceptingTokens: this.acceptingTokens !== false,
    serviceWindows: normalizeServiceWindows(this.serviceWindows),
    sessionEndsAt: toIsoOrNull(this.sessionEndsAt),
    reopenAt: toIsoOrNull(this.reopenAt),
    venue,
  };
};

export const Queue = mongoose.models.Queue || mongoose.model("Queue", queueSchema);
export { QUEUE_STATUSES };
