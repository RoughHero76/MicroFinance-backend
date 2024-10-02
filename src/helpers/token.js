//src/helpers/token.js

const jwt = require('jsonwebtoken');

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

module.exports = {
    generateToken,
    verifyToken,
    adminCheck,
    roleChecks
};