//src/routes/shared/sharedRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require("../../helpers/token");

const {
    search,
    loanDetailsCalculator,
    addProfilePictureAdminAndEmployee,

} = require('../../controllers/shared/sharedController');

const { appUpdateCheck, downloadApk } = require("../../helpers/appUpdate");

//NPA

const { 
    getLoanStatus, 
    getLoanStatusStatistics 
} = require('../../controllers/admin/loanStatus/loanStatusController');

const { updateLoanStatusesReq } = require("../../crone/LoanStatusCron");




router.post('/search', verifyToken, search);
router.post('/loan/calculate', verifyToken, loanDetailsCalculator);
router.post('/profile/add/porfilePicture', verifyToken, addProfilePictureAdminAndEmployee);

//NPA
router.get('/loan/status', verifyToken, getLoanStatus);
router.get('/loan/status/statistics', verifyToken, getLoanStatusStatistics);
router.get('/loan/statuses/update', verifyToken, updateLoanStatusesReq);

//App Checks
router.get('/app/update/check', verifyToken, appUpdateCheck);
router.get('/app/update/download', downloadApk);

module.exports = router;