const express = require('express');
const router = express.Router();

// Admin routes
const adminRoutes = require('./routes/admin/authRoutes');
const customerCRUD = require('./routes/admin/customer/customerCRUD');
const loanRoutes = require('./routes/admin/loan/loanRoutes');
const employeeRoutesCRUD = require('./routes/admin/employee/employeeRoutes');

// Employee routes
const employeeAuthRoutes = require('./routes/employee/authRoutes');
const employeeLoanRoutes = require('./routes/employee/loans/loanRoutes');

// Shared routes
const sharedRoutes = require('./routes/shared/sharedRoutes');

// Admin Routes
router.use('/admin', adminRoutes);
router.use('/admin/customer', customerCRUD);
router.use('/admin/loan', loanRoutes);
router.use('/admin/employee', employeeRoutesCRUD);

// Employee Routes
router.use('/employee', employeeAuthRoutes);
router.use('/employee/loan', employeeLoanRoutes);

// Shared Routes
router.use('/shared', sharedRoutes);

module.exports = router;