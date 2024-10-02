//src/routes/admin/customer/customerCRUD.js

const express = require('express');
const router = express.Router();
const {
    getCustomers,
    registerCustomer,
    updateCustomer,
    deleteCustomer,
    getTotalCustomers,
    addProfilePicture
} = require('../../../controllers/admin/customerController');
const { verifyToken, adminCheck } = require("../../../helpers/token");

// Private Routes

router.get('/', verifyToken, adminCheck, getCustomers);
router.post('/', verifyToken, adminCheck, registerCustomer);
router.put('/', verifyToken, adminCheck, updateCustomer);
router.delete('/', verifyToken, adminCheck, deleteCustomer);
router.get('/count/total', verifyToken, adminCheck, getTotalCustomers);
router.post('/profile/porfilePicture', verifyToken, adminCheck, addProfilePicture);

module.exports = router; 