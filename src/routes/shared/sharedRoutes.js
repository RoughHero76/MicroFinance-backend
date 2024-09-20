//src/routes/shared/sharedRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require("../../helpers/token");

const { 
    search,
    loanDetailsCalculator,
    
} = require('../../controllers/shared/sharedController');


router.post('/search', verifyToken, search);
router.post('/loan/calculate', verifyToken, loanDetailsCalculator);

module.exports = router;