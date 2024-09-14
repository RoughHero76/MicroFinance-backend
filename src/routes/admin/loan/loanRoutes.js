//src/routes/admin/loan/loanRoutes.js

const express = require('express');
const router = express.Router();
const {
  getLoans,
  createLoan,
  getCountofLoans,
  getTotalMarketDetails,
  deleteLoan,
  getRepaymentSchedule,
  approveLoan,
  rejectLoan,
  getRepaymentHistory,
  getRepaymentHistoryToApprove,
  approveRepaymentHistory
} = require('../../../controllers/admin/loanController');
const { verifyToken } = require("../../../helpers/token");

// Private Routes

router.get('/', verifyToken, getLoans);
router.post('/', verifyToken, createLoan);
router.delete('/', verifyToken, deleteLoan);
router.get('/approve', verifyToken, approveLoan);
router.get('/reject', verifyToken, rejectLoan);
router.get('/count/total', verifyToken, getCountofLoans);
router.get('/count/market/details', verifyToken, getTotalMarketDetails);
router.get('/repayment/schedule', verifyToken, getRepaymentSchedule);
router.get('/repayment/history', verifyToken, getRepaymentHistory);
router.get('/repayment/history/approve', verifyToken, getRepaymentHistoryToApprove);
router.post('/repayment/history/approve', verifyToken, approveRepaymentHistory);



module.exports = router;