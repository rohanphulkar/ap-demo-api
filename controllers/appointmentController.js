const Appointment = require("../models/Appointment");
const { sendEmail } = require("../utils/sendEmail");
const Razorpay = require("razorpay");
const crypto = require("crypto");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
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
      nuclear: 10000,
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
      currency: "INR",
      receipt: "order_" + Date.now(),
      payment_capture: 1,
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
      paymentStatus: "pending",
    });

    const savedAppointment = await appointment.save();

    res.status(201).json({
      appointment: savedAppointment,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
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

    // Send confirmation email with improved styling
    const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; color: #333;">
        <div style="background-color: #4CAF50; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Appointment Confirmation</h1>
        </div>
        
        <div style="padding: 20px; background-color: #f9f9f9; border-radius: 5px; margin-top: 20px;">
          <p style="font-size: 16px;">Dear <strong>${
            appointment.name
          }</strong>,</p>
          <p style="font-size: 16px;">Your appointment has been confirmed and payment has been received successfully.</p>
          
          <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h2 style="color: #4CAF50; margin-top: 0;">Appointment Details</h2>
            <ul style="list-style: none; padding: 0;">
              <li style="margin: 10px 0;"><strong>Test Type:</strong> ${
                appointment.testType
              }</li>
              <li style="margin: 10px 0;"><strong>Date:</strong> ${appointment.appointmentDate.toLocaleDateString()}</li>
              <li style="margin: 10px 0;"><strong>Time:</strong> ${appointment.appointmentDate.toLocaleTimeString()}</li>
              <li style="margin: 10px 0;"><strong>Amount Paid:</strong> ₹${
                appointment.amount
              }</li>
              <li style="margin: 10px 0;"><strong>Payment ID:</strong> ${paymentId}</li>
            </ul>
          </div>

          <div style="background-color: #fff3cd; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h2 style="color: #856404; margin-top: 0;">Important Instructions</h2>
            <ul style="list-style: none; padding: 0;">
              <li style="margin: 10px 0;">✓ Please arrive 15 minutes before your appointment time</li>
              <li style="margin: 10px 0;">✓ Bring any previous medical records related to this test</li>
              <li style="margin: 10px 0;">✓ Bring a valid ID proof</li>
              <li style="margin: 10px 0;">✓ Follow any specific preparation instructions for your test type</li>
            </ul>
          </div>

          <p style="font-size: 14px; color: #666;">If you need to cancel or reschedule, please contact us at least 24 hours before your appointment.</p>

          <div style="background-color: #e9ecef; padding: 20px; border-radius: 5px; margin-top: 20px;">
            <h2 style="color: #495057; margin-top: 0;">Contact Information</h2>
            <p style="margin: 5px 0;">📞 Phone: ${process.env.CONTACT_PHONE}</p>
            <p style="margin: 5px 0;">📧 Email: ${process.env.CONTACT_EMAIL}</p>
          </div>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
          <p>This is an automated email. Please do not reply to this message.</p>
        </div>
      </div>
    `;

    await sendEmail({
      to: appointment.email,
      subject: "Appointment Confirmation - Payment Received",
      html,
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

    // Send cancellation email with improved styling
    const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; color: #333;">
        <div style="background-color: #dc3545; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Appointment Cancelled</h1>
        </div>
        
        <div style="padding: 20px; background-color: #f9f9f9; border-radius: 5px; margin-top: 20px;">
          <p style="font-size: 16px;">Dear <strong>${
            appointment.name
          }</strong>,</p>
          <p style="font-size: 16px;">Your appointment has been cancelled.</p>
          
          <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h2 style="color: #dc3545; margin-top: 0;">Cancelled Appointment Details</h2>
            <ul style="list-style: none; padding: 0;">
              <li style="margin: 10px 0;"><strong>Test Type:</strong> ${
                appointment.testType
              }</li>
              <li style="margin: 10px 0;"><strong>Date:</strong> ${new Date(
                appointment.appointmentDate
              ).toLocaleDateString()}</li>
              <li style="margin: 10px 0;"><strong>Time:</strong> ${new Date(
                appointment.appointmentDate
              ).toLocaleTimeString()}</li>
            </ul>
          </div>

          <p style="font-size: 16px; text-align: center; margin-top: 20px;">
            If you wish to reschedule, please book a new appointment.
          </p>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
          <p>This is an automated email. Please do not reply to this message.</p>
        </div>
      </div>
    `;

    await sendEmail({
      to: appointment.email,
      subject: "Appointment Cancellation",
      html,
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
