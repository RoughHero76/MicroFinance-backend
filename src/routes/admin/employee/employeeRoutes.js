//sr/routes/admin/employee/employeeRoutes.js

const express = require('express');
const router = express.Router();

const {
    getEmployees,
    registerEmployee,
    updateEmployee,
    deleteEmployee,
    softDeleteEmployee,
    getTotalEmployees
} = require('../../../controllers/admin/employeeController');
const { verifyToken } = require("../../../helpers/token");


router.get('/', verifyToken, getEmployees);
router.get('/total', verifyToken, getTotalEmployees);
router.post('/', verifyToken, registerEmployee);
router.put('/', verifyToken, updateEmployee);
router.delete('/', verifyToken, softDeleteEmployee);
router.delete('/hard/delete', verifyToken, deleteEmployee);

module.exports = router;

