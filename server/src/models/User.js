import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ROLES = ["user", "admin", "staff"];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      default: "user",
      required: true,
    },
    /** Assigned venue for role=staff. Null for global admin and students. */
    staffVenue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      default: null,
    },
    /**
     * Optional allow-list of queues this staff member may manage.
     * Empty / missing means every queue in staffVenue.
     */
    staffQueues: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Queue" }],
      default: [],
    },
    /**
     * Bumped by "Sign out of all devices" and password resets. Session JWTs
     * carry it as `tv`; a mismatch is rejected. Missing on older documents →
     * treated as 0, which matches tokens issued before this field existed.
     */
    tokenVersion: { type: Number, default: 0 },
    /** Two-step sign-in (TOTP). Off unless the person enrolls. */
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorEnabledAt: { type: Date, default: null },
    /** AES-GCM sealed base32 seed (see services/secretBox.js). */
    twoFactorSecret: { type: String, default: null, select: false },
    /** Seed shown during enrollment, until the first code confirms it. */
    twoFactorPendingSecret: { type: String, default: null, select: false },
    twoFactorPendingAt: { type: Date, default: null, select: false },
    /** SHA-256 hashes of unused one-time backup codes. */
    twoFactorBackupCodes: { type: [String], default: [], select: false },
    /** Last accepted TOTP step — a code can only be used once. */
    twoFactorLastStep: { type: Number, default: null, select: false },
  },
  { timestamps: true }
);

userSchema.pre("validate", function validateStaffVenue() {
  if (this.role === "staff" && !this.staffVenue) {
    this.invalidate("staffVenue", "Staff must be assigned to a venue");
  }
  if (this.role !== "staff") {
    this.staffVenue = null;
    this.staffQueues = [];
  }
});

userSchema.statics.hashPassword = async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

userSchema.methods.comparePassword = async function comparePassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    role: this.role,
    staffVenueId: this.role === "staff" && this.staffVenue ? this.staffVenue.toString() : null,
    staffQueueIds:
      this.role === "staff"
        ? (this.staffQueues || []).map((id) => id.toString())
        : null,
    twoFactorEnabled: Boolean(this.twoFactorEnabled),
  };
};

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export { ROLES };
