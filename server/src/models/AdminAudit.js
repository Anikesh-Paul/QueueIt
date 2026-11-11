import mongoose from "mongoose";

/** 90-day retention for admin audit events. */
export const ADMIN_AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60;

const actorSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: null },
    email: { type: String, default: null },
    role: { type: String, default: null },
  },
  { _id: false }
);

const refSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: null },
  },
  { _id: false }
);

const adminAuditSchema = new mongoose.Schema(
  {
    actor: { type: actorSchema, required: true },
    action: { type: String, required: true, trim: true, maxlength: 64 },
    queue: { type: refSchema, default: null },
    venue: { type: refSchema, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

adminAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: ADMIN_AUDIT_TTL_SECONDS });
adminAuditSchema.index({ "queue.id": 1, createdAt: -1, _id: -1 });
adminAuditSchema.index({ "venue.id": 1, createdAt: -1, _id: -1 });

export const AdminAudit =
  mongoose.models.AdminAudit || mongoose.model("AdminAudit", adminAuditSchema);
