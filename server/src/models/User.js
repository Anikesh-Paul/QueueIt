import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ROLES = ["user", "admin"];

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
  },
  { timestamps: true }
);

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
  };
};

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export { ROLES };
