//src/routes/admin/customer/customerCRUD.js

const express = require('express');
const router = express.Router();
const {
    getCustomers,
    registerCustomer,
    updateCustomer,
    deleteCustomer,
    getTotalCustomers
} = require('../../../controllers/admin/customerController'); 
const { verifyToken } = require("../../../helpers/token");

// Private Routes

router.get('/', verifyToken, getCustomers);
router.post('/', verifyToken, registerCustomer);
router.put('/', verifyToken, updateCustomer); 
router.delete('/', verifyToken, deleteCustomer); 
router.get('/count/total', verifyToken, getTotalCustomers);

module.exports = router; 