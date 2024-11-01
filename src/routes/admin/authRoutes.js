const express = require('express');
const router = express.Router();
const { verifyToken, adminCheck } = require("../../helpers/token");
const {
    registerAdmin,
    loginAdmin,
    getAdminProfile,
    updateAdminProfile,
    updateAdminPassword,
} = require('../../controllers/admin/authController');

const { backupAndSendResponse } = require("../../helpers/backupUtils");

// Public routes
router.post('/register', registerAdmin);
router.post('/login', loginAdmin);

// Protected routes
router.get('/profile', verifyToken, adminCheck, getAdminProfile);
router.put('/profile', verifyToken, adminCheck, updateAdminProfile);
router.put('/password', verifyToken, adminCheck, updateAdminPassword);

router.get('/database/backup', verifyToken, adminCheck, backupAndSendResponse);


module.exports = router;