import mongoose from "mongoose";

const QUEUE_STATUSES = ["open", "paused"];

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
  },
  { timestamps: true }
);

queueSchema.index({ venue: 1, slug: 1 }, { unique: true });

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
    venue,
  };
};

export const Queue = mongoose.models.Queue || mongoose.model("Queue", queueSchema);
export { QUEUE_STATUSES };
