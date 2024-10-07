//src/routes/employee/loans/loanRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../helpers/token');

const {
    collectionsToBeCollectedToday,
    payACustomerInstallment,
    getCustomerProfile,
    getLoanDetails,
    applyPenaltyToALoanInstallment,
    getCustomers,
    collectionCountToday,
    getLoanStatistics,
    getRepaymentHistory
} = require('../../../controllers/employee/LoanCollection');

router.get('/collection/today', verifyToken, collectionsToBeCollectedToday);
router.get('/collection/today/count', verifyToken, collectionCountToday);
router.post('/pay', verifyToken, payACustomerInstallment);
router.get('/customer/profile', verifyToken, getCustomerProfile);
router.get('/customers', verifyToken, getCustomers);
router.get('/details', verifyToken, getLoanDetails);
router.post('/apply/planalty', verifyToken, applyPenaltyToALoanInstallment);
router.get('/statistics', verifyToken, getLoanStatistics);
router.get('/repayment/history', verifyToken, getRepaymentHistory);

module.exports = router