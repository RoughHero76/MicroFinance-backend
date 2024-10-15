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
  rejectRepaymentHistory,
  assignLoanToEmployee,
  applyPenaltyToALoanInstallment,
  removePenaltyFromALoanInstallment,
  closeLoan,
  addDocumentsToLoan,
  deleteDocumentsFromLoan
} = require('../../../controllers/admin/loans/loanController');
const {
  getRepaymentSchedule,
} = require('../../../controllers/admin/loans/RepaymentScheduleController');
const { generateReport } = require('../../../controllers/admin/loans/reports/reportsController');
const { verifyToken, adminCheck } = require("../../../helpers/token");

/******* Private Routes ********/

router.get('/', verifyToken, adminCheck, getLoans);
router.post('/', verifyToken, adminCheck, createLoan);
router.delete('/', verifyToken, adminCheck, deleteLoan);
router.post('/close', verifyToken, adminCheck, closeLoan);
router.get('/approve', verifyToken, adminCheck, approveLoan);
router.get('/reject', verifyToken, adminCheck, rejectLoan);
router.post('/assign', verifyToken, adminCheck, assignLoanToEmployee);
router.get('/count/total', verifyToken, adminCheck, getCountofLoans);
router.get('/count/market/details', verifyToken, adminCheck, getTotalMarketDetails);

//Repayments Routes
router.get('/repayment/schedule', verifyToken, adminCheck, getRepaymentSchedule);
router.get('/repayment/history', verifyToken, adminCheck, getRepaymentHistory);
router.get('/repayment/history/approve', verifyToken, adminCheck, getRepaymentHistoryToApprove);
router.post('/repayment/history/approve', verifyToken, adminCheck, approveRepaymentHistory);
router.post('/repayment/history/reject', verifyToken, adminCheck, rejectRepaymentHistory);

//Penalty Routes
router.post('/apply/planalty', verifyToken, adminCheck, applyPenaltyToALoanInstallment);
router.post('/remove/planalty', verifyToken, adminCheck, removePenaltyFromALoanInstallment);

//Documents Routes
router.post('/:loanId/add/documents', verifyToken, adminCheck, addDocumentsToLoan);
router.delete('/:loanId/delete/documents', verifyToken, adminCheck, deleteDocumentsFromLoan);

//Report
router.get('/report', verifyToken, adminCheck, generateReport);

module.exports = router;