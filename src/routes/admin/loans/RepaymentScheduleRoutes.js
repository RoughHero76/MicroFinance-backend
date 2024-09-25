const express = require('express');
const router = express.Router();
const {
    updateRepaymentSchedule
} = require('../../../controllers/admin/loans/RepaymentScheduleController');


router.post('/repayment/schedule/update', updateRepaymentSchedule);


module.exports = router