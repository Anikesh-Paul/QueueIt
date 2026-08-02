import mongoose from "mongoose";

/** Active and terminal membership states (leave/serve/skip land in later tickets). */
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
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Display token issued at join (sequential per queue). */
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

queueEntrySchema.index({ queue: 1, tokenNumber: 1 });
queueEntrySchema.index({ queue: 1, user: 1, status: 1 });

export const QueueEntry =
  mongoose.models.QueueEntry || mongoose.model("QueueEntry", queueEntrySchema);
export { ENTRY_STATUSES, ACTIVE_ENTRY_STATUSES };
