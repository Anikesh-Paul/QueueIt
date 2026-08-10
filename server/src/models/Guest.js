import crypto from "node:crypto";
import mongoose from "mongoose";

/**
 * Guest credential identity — device-bound peer on the student path.
 * Not a JWT role (roles remain user | admin). Soft upgrade (ticket 09) retires.
 */
const guestSchema = new mongoose.Schema(
  {
    /** Opaque secret presented by the client (header). Unique per Guest. */
    credential: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /**
     * Set when soft upgrade claims this Guest onto a User (ticket 09).
     * Null while the Guest path is active.
     */
    retiredAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/** Mint a high-entropy opaque credential string. */
guestSchema.statics.mintCredential = function mintCredential() {
  return crypto.randomBytes(32).toString("hex");
};

export const Guest = mongoose.models.Guest || mongoose.model("Guest", guestSchema);
