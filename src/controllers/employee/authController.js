//src/controllers/employee/authController.js

const Employee = require("../../models/Employee/EmployeeModel");
const { generateToken } = require("../../helpers/token");

exports.loginEmployee = async (req, res) => {
    try {
        const { userName, password } = req.body;

        // Find employee by username
        const employee = await Employee.findOne({ userName });
        if (!employee) {
            return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await employee.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }

        // Generate token
        const token = await generateToken(employee);

        // Update Login History
        employee.lastLogin = new Date();
        employee.loginHistory.push({ date: new Date() });
        await employee.save();

        res.json({
            status: 'success',
            message: 'Login successful',
            employee: {
                uid: employee.uid,
                fname: employee.fname,
                lname: employee.lname,
                email: employee.email,
                userName: employee.userName,
                role: employee.role
            },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ status: 'error', message: 'Error logging in employee' });

    }
}