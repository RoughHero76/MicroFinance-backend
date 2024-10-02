// Add this to your existing route file (e.g., src/routes/admin/dashboardRoutes.js)

const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../../controllers/admin/DashboardController');
const { verifyToken, adminCheck } = require("../../helpers/token");

router.get('/', verifyToken, adminCheck, getDashboardData);

module.exports = router;