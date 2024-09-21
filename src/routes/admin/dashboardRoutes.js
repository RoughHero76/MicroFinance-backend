// Add this to your existing route file (e.g., src/routes/admin/dashboardRoutes.js)

const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../../controllers/admin/DashboardController');
const { verifyToken } = require("../../helpers/token");

router.get('/', verifyToken, getDashboardData);

module.exports = router;