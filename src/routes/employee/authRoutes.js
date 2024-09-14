//src/routes/employee/authRoutes.js

const express = require('express');
const router = express.Router();
const {verifyToken} = require("../../helpers/token");
const {
    loginEmployee
} = require('../../controllers/employee/authController');


router.post('/auth/login', loginEmployee);


module.exports = router;