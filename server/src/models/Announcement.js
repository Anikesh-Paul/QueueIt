import mongoose from "mongoose";

export const ANNOUNCEMENT_SCOPES = ["campus", "venue", "queue"];
export const ANNOUNCEMENT_TONES = ["info", "delay", "closure"];
export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 280;

/** Ended notices are kept for 30 days so staff can see what went out recently. */
const RETENTION_SECONDS = 30 * 24 * 60 * 60;

const announcementSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ANNOUNCEMENT_SCOPES, required: true },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", default: null },
    queue: { type: mongoose.Schema.Types.ObjectId, ref: "Queue", default: null },
    /** Campus scope only: one organization's id ("default" for the main campus), or null for all. */
    organizationId: { type: String, default: null },
    tone: { type: String, enum: ANNOUNCEMENT_TONES, default: "info" },
    title: { type: String, required: true, trim: true, maxlength: ANNOUNCEMENT_TITLE_MAX },
    body: { type: String, trim: true, maxlength: ANNOUNCEMENT_BODY_MAX, default: "" },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    endedEarlyAt: { type: Date, default: null },
    author: {
      id: { type: String, default: null },
      name: { type: String, default: null },
    },
  },
  { timestamps: true }
);

announcementSchema.index({ endsAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });
announcementSchema.index({ startsAt: 1, endsAt: 1 });

export const Announcement =
  mongoose.models.Announcement || mongoose.model("Announcement", announcementSchema);
