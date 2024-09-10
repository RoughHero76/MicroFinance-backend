const express = require('express');
const router = express.Router();
const { verifyToken } = require("../../helpers/token");
const {
    registerAdmin,
    loginAdmin,
    getAdminProfile,
    updateAdminProfile,
    updateAdminPassword,
    loginHistory,
} = require('../../controllers/admin/authController');

// Public routes
router.post('/register', registerAdmin);
router.post('/login', loginAdmin);

// Protected routes
router.get('/profile', verifyToken, getAdminProfile);
router.put('/profile', verifyToken, updateAdminProfile);
router.put('/password', verifyToken, updateAdminPassword);
router.get('/login/history', verifyToken, loginHistory);


module.exports = router;