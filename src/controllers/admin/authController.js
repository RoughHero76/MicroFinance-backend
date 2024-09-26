const { generateToken } = require("../../helpers/token");
const { goodPassword, getPasswordErrors } = require("../../helpers/password");
const Admin = require("../../models/Admin/AdminModel");
const LoginHistory = require("../../models/Shared/LoginHistoryModel");
const LastSeen = require("../../models/Shared/LastSeenHistroyModel");
const { getSignedUrl, extractFilePath, uploadFile } = require("../../config/firebaseStorage");

const admin = require('firebase-admin');
const bucket = admin.storage().bucket();

exports.registerAdmin = async (req, res) => {
    try {
        const { fname, lname, email, userName, phoneNumber, password, AdminToken } = req.body;

        if (!AdminToken) {
            return res.status(400).json({ status: 'error', message: 'You are not authorized' });
        }

        if (AdminToken !== process.env.ADMIN_TOKEN) {
            return res.status(400).json({ status: 'error', message: 'Invalid authorization' });
        }

        if (!fname || !lname || !userName || !phoneNumber || !password) {
            return res.status(400).json({ status: 'error', message: 'All fields are required' });
        }


        // Check password strength
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


        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ $or: [{ email }, { userName }] });
        if (existingAdmin) {
            return res.status(400).json({ status: 'error', message: 'Admin already exists with this email or username' });
        }

        // Create new admin
        const newAdmin = new Admin({
            fname,
            lname,
            email,
            userName,
            phoneNumber,
            password
        });

        await newAdmin.save();

        // Generate token
        const token = await generateToken(newAdmin);

        res.status(201).json({
            status: 'success',
            message: 'Admin registered successfully',
            admin: {
                uid: newAdmin.uid,
                fname: newAdmin.fname,
                lname: newAdmin.lname,
                email: newAdmin.email,
                userName: newAdmin.userName
            },
            token
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ status: 'error', message: 'Error registering admin' });
    }
};

exports.loginAdmin = async (req, res) => {
    try {
        const { userName, password } = req.body;

        // Find admin by username
        const admin = await Admin.findOne({ userName });
        if (!admin) {
            return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }

        // Generate token
        const token = await generateToken(admin);

        // Create new login history entry
        const loginHistory = new LoginHistory({
            adminid: admin._id,
            date: new Date(),
        });
        await loginHistory.save();

        const lastSeen = new LastSeen({
            adminid: admin._id,
            date: new Date(),
            accuracy: 100,
            address: req.ip || 'Unknown'
        });
        await lastSeen.save();
        // Update admin's loginHistory reference
        admin.loginHistory = loginHistory._id;
        await admin.save();

        res.json({
            status: 'success',
            message: 'Login successful',
            user: {
                uid: admin.uid,
                fname: admin.fname,
                lname: admin.lname,
                email: admin.email,
                userName: admin.userName,
                role: admin.role,
                profilePic: admin.profilePic ? await getSignedUrl(extractFilePath(admin.profilePic)) : null
            },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ status: 'error', message: 'Error during login' });
    }
};
exports.getAdminProfile = async (req, res) => {
    try {
        const admin = await Admin.findOne({ uid: req.uid }).select('-password').populate('loginHistory');
        if (!admin) {
            return res.status(404).json({ status: 'error', message: 'Admin not found' });
        }

        if (admin.profilePic) {
            admin.profilePic = await getSignedUrl(extractFilePath(admin.profilePic));
        }

        res.json(
            {
                status: 'success',
                message: 'Profile fetched successfully',
                data: admin
            }
        );
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error fetching profile' });
    }
};

exports.updateAdminProfile = async (req, res) => {
    try {
        const { fname, lname, email, phoneNumber } = req.body;

        const admin = await Admin.findOne({ uid: req.uid });
        if (!admin) {
            return res.status(404).json({ status: 'error', message: 'Admin not found' });
        }

        // Update fields
        admin.fname = fname || admin.fname;
        admin.lname = lname || admin.lname;
        admin.email = email || admin.email;
        admin.phoneNumber = phoneNumber || admin.phoneNumber;
        admin.updatedAt = new Date();

        await admin.save();

        res.json({
            status: 'success',
            message: 'Profile updated successfully',
            admin: {
                uid: admin.uid,
                fname: admin.fname,
                lname: admin.lname,
                email: admin.email,
                phoneNumber: admin.phoneNumber
            }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ status: 'error', message: 'Error updating profile' });
    }
};

exports.updateAdminPassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const admin = await Admin.findOne({ uid: req.uid });
        if (!admin) {
            return res.status(404).json({ status: 'error', message: 'Admin not found' });
        }

        // Verify current password
        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
        }

        // Update password
        admin.password = newPassword;
        admin.updatedAt = new Date();

        await admin.save();

        res.json({ status: 'success', message: 'Password updated successfully' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ status: 'error', message: 'Error updating password' });
    }
};

