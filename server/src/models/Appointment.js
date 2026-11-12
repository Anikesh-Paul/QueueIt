import mongoose from "mongoose";

/**
 * A booked time slot at a queue. Checking in turns the booking into a
 * QueueEntry that is served in the appointment lane.
 */
export const APPOINTMENT_STATUSES = ["booked", "checked-in", "cancelled", "missed"];
export const ACTIVE_APPOINTMENT_STATUSES = ["booked", "checked-in"];

const appointmentSchema = new mongoose.Schema(
  {
    queue: { type: mongoose.Schema.Types.ObjectId, ref: "Queue", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Slot start instant (UTC). */
    slotStart: { type: Date, required: true },
    /** Slot length when booked (minutes), so later config changes do not move it. */
    slotMinutes: { type: Number, required: true, min: 1 },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: "booked", required: true },
    /** Queue entry created at check-in. */
    entry: { type: mongoose.Schema.Types.ObjectId, ref: "QueueEntry", default: null },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: String, enum: ["self", "staff", null], default: null },
    cancelledAt: { type: Date, default: null },
    missedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

appointmentSchema.index({ queue: 1, slotStart: 1, status: 1 });
appointmentSchema.index({ user: 1, status: 1, missedAt: -1 });
// One live booking per person per queue (blocks double-book races).
appointmentSchema.index(
  { queue: 1, user: 1 },
  {
    unique: true,
    name: "unique_active_booking",
    partialFilterExpression: { status: { $in: ACTIVE_APPOINTMENT_STATUSES } },
  }
);

export const Appointment =
  mongoose.models.Appointment || mongoose.model("Appointment", appointmentSchema);
