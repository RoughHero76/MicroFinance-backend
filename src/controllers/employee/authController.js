const Employee = require("../../models/Employee/EmployeeModel");
const { generateToken } = require("../../helpers/token");
const LoginHistory = require("../../models/Shared/LoginHistoryModel");
const LastSeen = require("../../models/Shared/LastSeenHistroyModel");
const { getSignedUrl, extractFilePath, uploadFile } = require("../../config/firebaseStorage");

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

        // Create new login history entry
        const loginHistory = new LoginHistory({
            employeeid: employee._id,
            date: new Date(),
            // You might want to add IP address, user agent, etc. here
        });
        await loginHistory.save();

        // Create new last seen entry
        const lastSeen = new LastSeen({
            employeeid: employee._id,
            date: new Date(),
            accuracy: 100,
            address: req.ip || 'Unknown'
        });
        await lastSeen.save();

        employee.loginHistory = loginHistory._id;
        employee.lastSeen = lastSeen._id;
        await employee.save();

        res.json({
            status: 'success',
            message: 'Login successful',
            user: {
                uid: employee.uid,
                fname: employee.fname,
                lname: employee.lname,
                email: employee.email,
                userName: employee.userName,
                role: employee.role,
                profilePic: employee.profilePic ? await getSignedUrl(extractFilePath(employee.profilePic)) : null
            },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ status: 'error', message: 'Error logging in employee' });
    }
};

exports.getEmployeeProfile = async (req, res) => {
    try {
        const employee = await Employee.findOne({ uid: req.uid }).select('-password').populate('loginHistory');
        if (!employee) {
            return res.status(404).json({ status: 'error', message: 'Employee not found' });
        }

        if (employee.profilePic) {
            employee.profilePic = await getSignedUrl(extractFilePath(employee.profilePic));
        }

        res.json({
            status: 'success',
            message: 'Profile fetched successfully',
            data: employee
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error fetching profile' });
    }
    
}