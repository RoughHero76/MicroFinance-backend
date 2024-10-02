// middleware/tenantMiddleware.js
const { getConnection, connectToDatabase } = require('../config/databaseConfig');

const tenantMiddleware = async (req, res, next) => {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
        return res.status(400).json({ message: 'Tenant ID is required' });
    }

    try {
        let connection = getConnection(tenantId);
        if (!connection) {
            connection = await connectToDatabase(tenantId);
        }
        req.tenantId = tenantId;
        req.dbConnection = connection;
        next();
    } catch (error) {
        res.status(500).json({ message: 'Failed to connect to tenant database' });
    }
};


const isAdmin = async (req, res, next) => {
    req.role = 'admin';
    next();
}

module.exports = { tenantMiddleware, isAdmin };
