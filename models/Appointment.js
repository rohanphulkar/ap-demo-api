const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    testType: {
      type: String,
      required: true,
      enum: [
        "xray",
        "ctscan",
        "mri",
        "ultrasound",
        "mammogram",
        "dexa",
        "pet",
        "angiography",
        "fluoroscopy",
        "nuclear",
      ],
    },
    appointmentDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending",
    },
    notes: {
      type: String,
      trim: true,
      maxLength: 500,
    },
    amount: {
      type: Number,
      required: true,
    },
    orderId: {
      type: String,
      required: true,
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ["pending", "completed"],
      default: "pending",
    },
    paymentId: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const Appointment = mongoose.model("Appointment", appointmentSchema);

module.exports = Appointment;
