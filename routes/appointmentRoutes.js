const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');

// Get appointments with filters, search and pagination
router.get('/', appointmentController.getAppointments);

// Get specific appointment details
router.get('/:id', appointmentController.getAppointment);

// Book new appointment
router.post('/', appointmentController.bookAppointment);

// Verify payment and confirm appointment
router.post('/verify-payment', appointmentController.verifyPayment);

// Cancel appointment
router.patch('/:id/cancel', appointmentController.cancelAppointment);

// Delete appointment
router.delete('/:id', appointmentController.deleteAppointment);

module.exports = router;
