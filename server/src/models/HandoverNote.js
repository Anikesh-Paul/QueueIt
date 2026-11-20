import mongoose from "mongoose";

export const HANDOVER_BODY_MAX = 500;
export const HANDOVER_PREVIEW_MAX = 120;

/** Keep resolved or expired notes for 30 days, then drop them. */
const actorSchema = {
  id: { type: String, default: null },
  name: { type: String, default: null },
};

const handoverNoteSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true, maxlength: HANDOVER_BODY_MAX },
    queue: { type: mongoose.Schema.Types.ObjectId, ref: "Queue", required: true, index: true },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    organizationId: { type: String, default: "default" },
    counter: { type: mongoose.Schema.Types.ObjectId, default: null },
    counterName: { type: String, default: null },
    author: actorSchema,
    important: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    resolvedBy: actorSchema,
    expiresAt: { type: Date, required: true },
    expiryHours: { type: Number, default: 24 },
    acknowledgedBy: [
      {
        id: { type: String, default: null },
        name: { type: String, default: null },
        at: { type: Date, default: Date.now },
      },
    ],
    /** When Mongo may drop this row (30 days after expiry or resolve). */
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true }
);

handoverNoteSchema.index({ queue: 1, resolvedAt: 1, expiresAt: 1, createdAt: -1 });
handoverNoteSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const HandoverNote =
  mongoose.models.HandoverNote || mongoose.model("HandoverNote", handoverNoteSchema);
