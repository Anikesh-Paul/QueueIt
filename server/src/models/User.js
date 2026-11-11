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
  };
};

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export { ROLES };
