import mongoose from "mongoose";

const venueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /** Stable key for idempotent seed upserts (not a multi-venue admin UI). */
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    /** Owning organization; null = the built-in default organization. */
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
  },
  { timestamps: true }
);

venueSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    organizationId: this.organization ? this.organization.toString() : null,
  };
};

export const Venue = mongoose.models.Venue || mongoose.model("Venue", venueSchema);
