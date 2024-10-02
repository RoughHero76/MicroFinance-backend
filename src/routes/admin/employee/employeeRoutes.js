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
const { verifyToken, adminCheck, } = require("../../../helpers/token");


router.get('/', verifyToken, adminCheck, getEmployees);
router.get('/total', verifyToken, adminCheck, getTotalEmployees);
router.post('/', verifyToken, adminCheck, registerEmployee);
router.put('/', verifyToken, adminCheck, updateEmployee);
router.delete('/', verifyToken, adminCheck, softDeleteEmployee);
router.delete('/hard/delete', verifyToken, adminCheck, deleteEmployee);

module.exports = router;

