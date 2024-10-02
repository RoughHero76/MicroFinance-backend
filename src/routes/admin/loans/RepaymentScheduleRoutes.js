const express = require('express');
const router = express.Router();
const {
    updateRepaymentSchedule
} = require('../../../controllers/admin/loans/RepaymentScheduleController');
const { verifyToken, adminCheck } = require("../../../helpers/token");


router.post('/repayment/schedule/update', verifyToken, adminCheck, updateRepaymentSchedule);


module.exports = router