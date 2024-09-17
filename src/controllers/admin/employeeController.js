// src/controllers/admin/employeeController.js
const mongoose = require('mongoose');
const Employee = require('../../models/Employee/EmployeeModel');
const { goodPassword, getPasswordErrors } = require('../../helpers/password');
const Loan = require('../../models/Customers/Loans/LoanModel');

// Register a new Employee
exports.registerEmployee = async (req, res) => {
    try {
        const {
            fname, // Required
            lname, // Required
            email,
            userName, // Required
            phoneNumber, // Required
            password, // Required
            profilePic,
            address,
            emergencyContact,
            role
        } = req.body;

        if (!fname || !lname || !userName || !phoneNumber || !password) {
            return res.status(400).json({ status: 'error', message: 'Required fields are missing' });
        }

        if (password.length < 8) {
            return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long' });
        }

        if (!goodPassword(password)) {
            const errorMessages = getPasswordErrors(password);
            return res.status(400).json({
                status: 'error',
                error: errorMessages,
                message: 'Password does not meet the requirements'
            });
        }

        // Check if employee already exists by email or phone number
        const existingEmployee = await Employee.findOne({ $or: [{ phoneNumber }, { email }] });
        if (existingEmployee) {
            return res.status(400).json({ status: 'error', message: 'Employee already exists with this email or phone number' });
        }

        const employee = new Employee({
            fname,
            lname,
            email,
            userName,
            phoneNumber,
            password,
            profilePic,
            address,
            emergencyContact,
            role
        });

        await employee.save();
        res.json({ status: 'success', message: 'Employee registered successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

// Get a list of Employees
exports.getEmployees = async (req, res) => {
    try {
        const { phoneNumber, uid, role, accountStatus, page = 1, limit = 10, includeSensitiveData } = req.query;
        let query = {};

        // Construct query based on request parameters
        if (phoneNumber) query.phoneNumber = phoneNumber;
        if (uid) query.uid = uid;
        if (role) query.role = role;
        if (accountStatus) query.accountStatus = accountStatus;

        const skip = (page - 1) * limit;

        // Define fields to exclude
        let projection = { password: 0, loginHistory: 0, LastSeenHistory: 0, collectedRepayments: 0 };

        // Include sensitive data if requested
        if (includeSensitiveData === 'true') {
            projection = {}; // Show all fields, including password and loginHistory
        }

        // Fetch employees with projection
        const employees = await Employee.find(query)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .select(projection); // Apply projection here

        // Get the total count of documents for pagination
        const total = await Employee.countDocuments(query);

        // Send response
        res.json({
            status: 'success',
            data: employees,
            page: Number(page),
            limit: Number(limit),
            total
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};


//Soft Delete Employee
exports.softDeleteEmployee = async (req, res) => {
    try {
        const { uid } = req.query;
        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'uid is required' });
        }

        const employee = await Employee.findOne({ uid });
        if (!employee) {
            return res.status(404).json({ status: 'error', message: 'Employee not found' });
        }

        employee.isDeleted = true;

        await employee.save();

        res.json({ status: 'success', message: 'Employee deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

// Delete an Employee
exports.deleteEmployee = async (req, res) => {
    try {
        const { uid } = req.query;
        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'uid is required' });
        }

        const employee = await Employee.findOne({ uid });
        if (!employee) {
            return res.status(404).json({ status: 'error', message: 'Employee not found' });
        }

        await Employee.deleteOne({ uid });
        res.json({ status: 'success', message: 'Employee deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

// Update an Employee
exports.updateEmployee = async (req, res) => {
    try {
        const { uid } = req.query;
        const {
            fname, lname, email, userName, phoneNumberVerified, phoneNumber, address, emergencyContact, role, accountStatus
        } = req.body;

        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'uid is required' });
        }

        const employee = await Employee.findOne({ uid });
        if (!employee) {
            return res.status(404).json({ status: 'error', message: 'Employee not found' });
        }

        employee.fname = fname || employee.fname;
        employee.lname = lname || employee.lname;
        employee.email = email || employee.email;
        employee.userName = userName || employee.userName;
        employee.phoneNumberVerified = phoneNumberVerified || employee.phoneNumberVerified;
        employee.phoneNumber = phoneNumber || employee.phoneNumber;
        employee.address = address || employee.address;
        employee.emergencyContact = emergencyContact || employee.emergencyContact;
        employee.role = role || employee.role;
        employee.accountStatus = accountStatus !== undefined ? accountStatus : employee.accountStatus;

        await employee.save();
        res.json({ status: 'success', message: 'Employee updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

// Get Total Employee Count
exports.getTotalEmployees = async (req, res) => {
    try {
        const totalEmployees = await Employee.countDocuments();
        res.json({ status: 'success', data: totalEmployees });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

