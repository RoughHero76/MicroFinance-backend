//src/routes/admin/loan/loanRoutes.js

const express = require('express');
const router = express.Router();
const {
    getLoans,
    createLoan,
    getCountofLoans,
    getTotalMarketDetails,
    deleteLoan,
    getRepaymentSchedule
  } = require('../../../controllers/admin/loanController'); 
const { verifyToken } = require("../../../helpers/token");

// Private Routes

router.get('/', verifyToken, getLoans);
router.post('/', verifyToken, createLoan);
router.delete('/', verifyToken, deleteLoan);
router.get('/count/total', verifyToken, getCountofLoans);
router.get('/count/market/details', verifyToken, getTotalMarketDetails);
router.get('/repayment/schedule', verifyToken, getRepaymentSchedule);



module.exports = router;