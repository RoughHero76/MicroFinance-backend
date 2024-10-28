//src/helpers/token.js

const jwt = require('jsonwebtoken');
const Customer = require('../models/Customers/profile/CustomerModel');
const Admin = require('../models/Admin/AdminModel');
const Employee = require('../models/Employee/EmployeeModel');

async function generateToken(user) {
    const token = jwt.sign
        (
            { uid: user.uid, email: user.email, role: user.role, _id: user._id },
            process.env.JWT_SECRET_TOKEN,
            { expiresIn: process.env.JWT_SECRET_TOKEN_EXPIRY }
        );
    return token;
}


async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Invalid token format' });
    }


    jwt.verify(token, process.env.JWT_SECRET_TOKEN, (err, decoded) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                //console.error('Token expired:', err);
                return res.status(401).json({ message: 'Token expired' });
            } else if (err.name === 'JsonWebTokenError') {
                //console.error('Invalid token:', err);
                return res.status(401).json({ message: 'Invalid token' });
            } else {
                //console.error('Token verification error:', err);
                return res.status(401).json({ message: 'Invalid token' });
            }
        }
        req.uid = decoded.uid;
        req._id = decoded._id;
        req.role = decoded.role;
        next();
    });
}


async function adminCheck(req, res, next) {

    if (req.role === 'admin') {
        next();
    } else {
        return res.status(403).json({ message: 'Unauthorized' }); // Send unauthorized response
    }
}


async function roleChecks(req, res, next) {
    if (req.user.role === 'employee') {
        next();
    } else if (req.user.role === 'admin') {
        next();
    }
    else {
        return res.status(403).json({ message: 'Unauthorized' });
    }
}

async function storeFcmToken(req, res) {
    try {
        const id = req._id;
        const role = req.role;
        const { fcmToken } = req.body;

        if (!id || !fcmToken) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Define model based on role
        let Model;
        if (role === 'admin') {
            Model = Admin;
        } else if (role === 'employee') {
            Model = Employee;
        } else if (role === 'customer') {
            Model = Customer;
        } else {
            return res.status(400).json({ message: 'Invalid role' });
        }
        const user = await Model.findOne({ _id: id });
        if (!user) {
            return res.status(404).json({ message: `${role.charAt(0).toUpperCase() + role.slice(1)} not found` });
        }
        
        user.fcmToken = fcmToken;
        await user.save();

        return res.status(200).json({ message: 'Token stored successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}



module.exports = {
    generateToken,
    verifyToken,
    adminCheck,
    roleChecks,
    storeFcmToken
};