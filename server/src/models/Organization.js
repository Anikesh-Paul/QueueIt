import mongoose from "mongoose";

/**
 * A tenant that owns venues (a campus, a hospital annex, ...). Venues with no
 * organization belong to the built-in default organization, so existing data
 * needs no migration.
 */
const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  },
  { timestamps: true }
);

organizationSchema.methods.toPublicJSON = function toPublicJSON() {
  return { id: this._id.toString(), slug: this.slug, name: this.name, isDefault: false };
};

export const Organization =
  mongoose.models.Organization || mongoose.model("Organization", organizationSchema);
