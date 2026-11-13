import mongoose from "mongoose";

/** Active and terminal membership states (serve/skip admin transitions in ticket 07). */
const ENTRY_STATUSES = ["waiting", "serving", "served", "skipped", "left"];

/** Statuses that count as an active place in line (blocks double-join). */
const ACTIVE_ENTRY_STATUSES = ["waiting", "serving"];

const queueEntrySchema = new mongoose.Schema(
  {
    queue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Queue",
      required: true,
      index: true,
    },
    /**
     * Authenticated joiner. Optional for admin walk-ins and Guest app joins.
     * Walk-ins set isWalkIn + walkInName; Guests set guest instead.
     */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
      index: true,
    },
    /**
     * Guest joiner (device-bound credential). Mutually exclusive with user and walk-in.
     * Not the same as isWalkIn (admin counter-created).
     */
    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Guest",
      required: false,
      default: null,
      index: true,
    },
    /** True when the entry was created by admin walk-in (no User account). */
    isWalkIn: {
      type: Boolean,
      default: false,
      required: true,
    },
    /** Display name for walk-in entries (admin counter-created). Ignored when user/guest is set. */
    walkInName: {
      type: String,
      trim: true,
      default: null,
    },
    /** Display token issued at join (sequential per queue, or manual for walk-in). */
    tokenNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ENTRY_STATUSES,
      default: "waiting",
      required: true,
      index: true,
    },
    /** When this entry was called to the counter (status serving). */
    calledAt: { type: Date, default: null },
    /** Absolute deadline for a no-show skip. Null while pause is holding the timer. */
    servingDeadlineAt: { type: Date, default: null },
    /** Remaining ms when the queue was paused mid-call. */
    servingPausedRemainingMs: { type: Number, default: null, min: 0 },
    /** When the called student tapped "I'm here". Clears the no-show deadline. */
    arrivedAt: { type: Date, default: null },
    /** Grace window (minutes) applied when this entry was called. */
    noShowWindowMinutes: { type: Number, default: null, min: 1, max: 30 },
    /** Whether that window came from fixed or dynamic resolution. */
    noShowWindowMode: { type: String, enum: ["fixed", "dynamic"], default: null },
    /** Counter this entry was called or served at (subdocument id on Queue.counters). */
    servingCounterId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    /** When this entry was skipped (no-show or staff skip). */
    skippedAt: { type: Date, default: null },
    /** Why the entry was skipped: "no-show" = grace period ran out, "staff" = skipped by staff. Null on older rows. */
    skipReason: { type: String, enum: ["no-show", "staff"], default: null },
    /** When a called ticket ended as a no-show. Kept after a rejoin so repeat no-shows still count. */
    noShowAt: { type: Date, default: null },
    /** How many times this ticket was a no-show (a rejoined ticket can miss again). */
    noShows: { type: Number, default: 0, min: 0 },
    /** When this visit last used missed-turn recovery. */
    recoveredAt: { type: Date, default: null },
    /** Recoveries used on this visit. Max 1. */
    recoveryCount: { type: Number, default: 0, min: 0 },
    /**
     * Fair waiting order. Defaults to tokenNumber * 1000 at join.
     * Recovery may assign a value between existing waiters.
     */
    waitOrder: { type: Number, default: null },
    /** True while the student is back in line after a missed-turn recovery. */
    returning: { type: Boolean, default: false },
    /** Approved priority flag. Pending requests leave this false. */
    priority: { type: Boolean, default: false },
    priorityReason: {
      type: String,
      enum: ["accessibility", "pregnancy", "medical", "other"],
      default: null,
    },
    priorityRequestStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: null,
    },
    priorityRequestedAt: { type: Date, default: null },
    /** When this entry was served. */
    servedAt: { type: Date, default: null },
    /** Booking this entry came from (checked-in appointment). */
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
    /** Booked slot start. Set only for appointment entries; drives the appointment lane. */
    appointmentAt: { type: Date, default: null },
    /** Minutes it takes this person to reach the counter; null = default. */
    travelMinutes: { type: Number, min: 0, max: 120, default: null },
    /** How an app join arrived: "qr" from a printed poster / kiosk QR, otherwise "app". */
    joinSource: { type: String, enum: ["app", "qr"], default: "app" },
  },
  { timestamps: true }
);

queueEntrySchema.pre("validate", function ensureWaitOrder() {
  if (this.waitOrder == null && this.tokenNumber != null) {
    this.waitOrder = Number(this.tokenNumber) * 1000;
  }
});

queueEntrySchema.pre("validate", function ensureMembershipIdentity() {
  if (this.isWalkIn) {
    if (!this.walkInName || !String(this.walkInName).trim()) {
      this.invalidate("walkInName", "Walk-in name is required");
    }
    this.user = null;
    this.guest = null;
    return;
  }

  const hasUser = Boolean(this.user);
  const hasGuest = Boolean(this.guest);

  if (hasUser && hasGuest) {
    this.invalidate("guest", "Entry cannot belong to both User and Guest");
    return;
  }
  if (hasGuest) {
    this.user = null;
    return;
  }
  if (hasUser) {
    this.guest = null;
    return;
  }
  this.invalidate("user", "User or Guest is required for app-joined entries");
});

queueEntrySchema.index({ queue: 1, tokenNumber: 1 });
// Speeds live position / waiting-list scans: count of waiters with a lower token.
queueEntrySchema.index({ queue: 1, status: 1, tokenNumber: 1 });
queueEntrySchema.index({ queue: 1, user: 1, status: 1 });
queueEntrySchema.index({ queue: 1, guest: 1, status: 1 });

// One active token and one active membership per queue (blocks check-then-create races).
queueEntrySchema.index(
  { queue: 1, tokenNumber: 1 },
  {
    unique: true,
    name: "unique_active_queue_token",
    partialFilterExpression: { status: { $in: ACTIVE_ENTRY_STATUSES } },
  }
);
queueEntrySchema.index(
  { queue: 1, user: 1 },
  {
    unique: true,
    name: "unique_active_queue_user",
    partialFilterExpression: {
      status: { $in: ACTIVE_ENTRY_STATUSES },
      user: { $type: "objectId" },
    },
  }
);
queueEntrySchema.index(
  { queue: 1, guest: 1 },
  {
    unique: true,
    name: "unique_active_queue_guest",
    partialFilterExpression: {
      status: { $in: ACTIVE_ENTRY_STATUSES },
      guest: { $type: "objectId" },
    },
  }
);

/** Mongo duplicate-key (unique index) violation. */
export function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === 11000 || err.code === 11001));
}

export const QueueEntry =
  mongoose.models.QueueEntry || mongoose.model("QueueEntry", queueEntrySchema);
export { ENTRY_STATUSES, ACTIVE_ENTRY_STATUSES };
