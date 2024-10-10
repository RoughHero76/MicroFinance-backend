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



router.post('/search', verifyToken, search);
router.post('/loan/calculate', verifyToken, loanDetailsCalculator);
router.post('/profile/add/porfilePicture', verifyToken, addProfilePictureAdminAndEmployee);


//App Checks
router.get('/app/update/check', verifyToken, appUpdateCheck);
router.get('/app/update/download', downloadApk);

module.exports = router;