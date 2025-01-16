const nodemailer = require("nodemailer");
const { config } = require("dotenv");

config();

/**
 * Creates and configures the email transporter
 * @returns {nodemailer.Transporter} Configured email transporter
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

/**
 * Generic email sender function
 * @param {Object} params Email parameters
 * @param {string} params.to Recipient email address
 * @param {string} params.subject Email subject
 * @param {string} params.html Email HTML content
 * @returns {Promise<Object>} Sending result
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return info;
  } catch (error) {
    console.error("Email sending failed:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = {
  sendEmail,
};
