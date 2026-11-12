import mongoose from "mongoose";

/**
 * One rating per served ticket. The counter name is copied at write time so
 * renaming or removing a counter does not rewrite history.
 */
const feedbackSchema = new mongoose.Schema(
  {
    queue: { type: mongoose.Schema.Types.ObjectId, ref: "Queue", required: true },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", default: null },
    entry: { type: mongoose.Schema.Types.ObjectId, ref: "QueueEntry", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest", default: null },
    counterId: { type: mongoose.Schema.Types.ObjectId, default: null },
    counterName: { type: String, trim: true, maxlength: 60, default: null },
    tokenNumber: { type: Number, default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500, default: "" },
    servedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

feedbackSchema.index({ entry: 1 }, { unique: true });
feedbackSchema.index({ queue: 1, createdAt: -1 });

export const Feedback = mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);
