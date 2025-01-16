const Appointment = require("../models/Appointment");
const { sendEmail } = require("../utils/sendEmail");
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Get appointments with filters, search and pagination
exports.getAppointments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.testType) filter.testType = req.query.testType;
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { email: { $regex: req.query.search, $options: "i" } },
        { phone: { $regex: req.query.search, $options: "i" } },
      ];
    }

    // Date range filter
    if (req.query.startDate && req.query.endDate) {
      filter.appointmentDate = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    const appointments = await Appointment.find(filter)
      .sort({ appointmentDate: "asc" })
      .skip(skip)
      .limit(limit);

    const total = await Appointment.countDocuments(filter);

    res.status(200).json({
      appointments,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalAppointments: total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get specific appointment details
exports.getAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }
    res.status(200).json(appointment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Book new appointment
exports.bookAppointment = async (req, res) => {
  try {
    // Validate required fields
    const requiredFields = [
      "name",
      "email", 
      "phone",
      "testType",
      "appointmentDate",
    ];
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({ message: `${field} is required` });
      }
    }

    // Validate email format
    const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(req.body.email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    // Validate phone number format
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(req.body.phone)) {
      return res
        .status(400)
        .json({ message: "Please enter a valid 10-digit phone number" });
    }

    // Validate test type and get price
    const testPrices = {
      xray: 1000,
      ctscan: 5000,
      mri: 8000,
      ultrasound: 2000,
      mammogram: 3000,
      dexa: 2500,
      pet: 15000,
      angiography: 12000,
      fluoroscopy: 4000,
      nuclear: 10000
    };

    if (!testPrices[req.body.testType]) {
      return res.status(400).json({ message: "Invalid test type" });
    }

    const amount = testPrices[req.body.testType];

    // Validate appointment date
    const appointmentDate = new Date(req.body.appointmentDate);
    const now = new Date();
    if (appointmentDate < now) {
      return res
        .status(400)
        .json({ message: "Appointment date cannot be in the past" });
    }

    // Check for conflicting appointments
    const conflictingAppointment = await Appointment.findOne({
      appointmentDate: appointmentDate,
      testType: req.body.testType,
      status: { $ne: "cancelled" },
    });

    if (conflictingAppointment) {
      return res
        .status(400)
        .json({ message: "This time slot is already booked" });
    }

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: amount * 100, // Amount in paise
      currency: 'INR',
      receipt: 'order_' + Date.now(),
      payment_capture: 1
    });

    // Create and save appointment
    const appointment = new Appointment({
      name: req.body.name.trim(),
      email: req.body.email.toLowerCase().trim(),
      phone: req.body.phone.trim(),
      testType: req.body.testType,
      appointmentDate: appointmentDate,
      notes: req.body.notes?.trim(),
      status: "pending",
      amount: amount,
      orderId: order.id,
      paymentStatus: "pending"
    });

    const savedAppointment = await appointment.save();

    res.status(201).json({
      appointment: savedAppointment,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Verify payment and confirm appointment
exports.verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    // Verify payment signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (generatedSignature !== signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    // Update appointment status
    const appointment = await Appointment.findOne({ orderId });
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    appointment.status = "confirmed";
    appointment.paymentStatus = "completed";
    appointment.paymentId = paymentId;
    const confirmedAppointment = await appointment.save();

    // Send confirmation email
    const html = `
        <h1>Appointment Confirmation</h1>
        <p>Dear ${appointment.name},</p>
        <p>Your appointment has been confirmed and payment has been received successfully.</p>
        <p>Details:</p>
        <ul>
          <li>Test Type: ${appointment.testType}</li>
          <li>Date: ${appointment.appointmentDate.toLocaleDateString()}</li>
          <li>Time: ${appointment.appointmentDate.toLocaleTimeString()}</li>
          <li>Amount Paid: ₹${appointment.amount}</li>
          <li>Payment ID: ${paymentId}</li>
        </ul>
        <p>Important Instructions:</p>
        <ul>
          <li>Please arrive 15 minutes before your appointment time</li>
          <li>Bring any previous medical records related to this test</li>
          <li>Bring a valid ID proof</li>
          <li>Follow any specific preparation instructions for your test type</li>
        </ul>
        <p>If you need to cancel or reschedule, please contact us at least 24 hours before your appointment.</p>
        <p>Contact Information:</p>
        <ul>
          <li>Phone: ${process.env.CONTACT_PHONE}</li>
          <li>Email: ${process.env.CONTACT_EMAIL}</li>
        </ul>
    `;

    await sendEmail({
      to: appointment.email,
      subject: "Appointment Confirmation - Payment Received",
      html
    });

    res.status(200).json(confirmedAppointment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Cancel appointment
exports.cancelAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    appointment.status = "cancelled";
    const updatedAppointment = await appointment.save();

    // Send cancellation email
    const html = `
        <h1>Appointment Cancelled</h1>
        <p>Dear ${appointment.name},</p>
        <p>Your appointment has been cancelled.</p>
        <p>Cancelled appointment details:</p>
        <ul>
          <li>Test Type: ${appointment.testType}</li>
          <li>Date: ${new Date(
            appointment.appointmentDate
          ).toLocaleDateString()}</li>
          <li>Time: ${new Date(
            appointment.appointmentDate
          ).toLocaleTimeString()}</li>
        </ul>
        <p>If you wish to reschedule, please book a new appointment.</p>
    `;

    await sendEmail({
      to: appointment.email,
      subject: "Appointment Cancellation",
      html
    });

    res.status(200).json(updatedAppointment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete appointment
exports.deleteAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    await Appointment.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Appointment deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
