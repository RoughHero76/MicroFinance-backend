//src/routes/shared/sharedRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require("../../helpers/token");

const { search } = require('../../controllers/shared/sharedController');


router.post('/search', verifyToken, search);

module.exports = router;