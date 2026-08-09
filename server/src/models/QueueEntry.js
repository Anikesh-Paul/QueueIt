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
     * Authenticated joiner. Optional for admin walk-ins (counter arrivals without app join).
     * Walk-ins set isWalkIn + walkInName instead.
     */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
    /** Display name for walk-in entries (counter guest). Ignored when user is set. */
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
  },
  { timestamps: true }
);

queueEntrySchema.pre("validate", function ensureMembershipIdentity() {
  if (this.isWalkIn) {
    if (!this.walkInName || !String(this.walkInName).trim()) {
      this.invalidate("walkInName", "Walk-in name is required");
    }
    this.user = null;
  } else if (!this.user) {
    this.invalidate("user", "User is required for app-joined entries");
  }
});

queueEntrySchema.index({ queue: 1, tokenNumber: 1 });
queueEntrySchema.index({ queue: 1, user: 1, status: 1 });

export const QueueEntry =
  mongoose.models.QueueEntry || mongoose.model("QueueEntry", queueEntrySchema);
export { ENTRY_STATUSES, ACTIVE_ENTRY_STATUSES };
