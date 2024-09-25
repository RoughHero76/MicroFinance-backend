//src/routes/admin/loan/loanRoutes.js

const express = require('express');
const router = express.Router();
const {
  getLoans,
  createLoan,
  getCountofLoans,
  getTotalMarketDetails,
  deleteLoan,
  approveLoan,
  rejectLoan,
  getRepaymentHistory,
  getRepaymentHistoryToApprove,
  approveRepaymentHistory,
  assignLoanToEmployee,
  applyPenaltyToALoanInstallment,
  removePenaltyFromALoanInstallment,
  closeLoan
} = require('../../../controllers/admin/loans/loanController');
const {
  getRepaymentSchedule,
} = require('../../../controllers/admin/loans/RepaymentScheduleController');
const { verifyToken } = require("../../../helpers/token");

/******* Private Routes ********/

router.get('/', verifyToken, getLoans);
router.post('/', verifyToken, createLoan);
router.delete('/', verifyToken, deleteLoan);
router.post('/close', verifyToken, closeLoan);
router.get('/approve', verifyToken, approveLoan);
router.get('/reject', verifyToken, rejectLoan);
router.post('/assign', verifyToken, assignLoanToEmployee);
router.get('/count/total', verifyToken, getCountofLoans);
router.get('/count/market/details', verifyToken, getTotalMarketDetails);

//Repayments Routes
router.get('/repayment/schedule', verifyToken, getRepaymentSchedule);
router.get('/repayment/history', verifyToken, getRepaymentHistory);
router.get('/repayment/history/approve', verifyToken, getRepaymentHistoryToApprove);
router.post('/repayment/history/approve', verifyToken, approveRepaymentHistory);

//Penalty Routes
router.post('/apply/planalty', verifyToken, applyPenaltyToALoanInstallment);
router.post('/remove/planalty', verifyToken, removePenaltyFromALoanInstallment);



module.exports = router;