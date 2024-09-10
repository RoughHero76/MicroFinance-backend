//src/controller/admin/customerController.js

const mongoose = require('mongoose');
const Customer = require('../../models/Customers/profile/CustomerModel');


exports.registerCustomer = async (req, res) => {
    try {
        const {
            fname, //Required
            lname, //Required
            gender,
            email,
            userName,
            phoneNumber, //Required
            address,
            city,
            state,
            country,
            pincode,

        } = req.body;

        if (!fname || !lname || !phoneNumber) {
            return res.status(400).json({ status: 'error', message: 'All fields are required' });
        }
        // Check if customer already exists
        const existingCustomer = await Customer.findOne({ phoneNumber });

        if (existingCustomer) {
            return res.status(400).json({ status: 'error', message: 'Customer already exists with this phone number' });
        }

        const customer = new Customer({
            fname,
            lname,
            gender,
            email,
            userName,
            phoneNumber,
            address,
            city,
            state,
            country,
            pincode,
        });
        await customer.save();
        res.json({ status: 'success', message: 'Customer registered successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}

exports.getCustomers = async (req, res) => {
    try {
        const { phoneNumber, uid, fullDetails, accountStatus, page = 1, limit = 10 } = req.query;
        let query = {};

        if (phoneNumber) {
            query.phoneNumber = phoneNumber;
        }

        if (uid) {
            query.uid = uid;
        }

        if (accountStatus) {
            query.accountStatus = accountStatus;
        } else {
            query.accountStatus = 'true';
        }

        let loanFields = 'loanAmount loanStartDate loanEndDate loanDuration totalPaid installmentFrequency numberOfInstallments status';
        if (fullDetails === 'true') {
            loanFields = '';
        }

        const skip = (page - 1) * limit;

        const customers = await Customer.find(query)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .populate({
                path: 'loans',
                select: loanFields
            });

        const total = await Customer.countDocuments(query);

        res.json({
            status: 'success',
            data: customers,
            page: Number(page),
            limit: Number(limit),
            total
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};


exports.deleteCustomer = async (req, res) => {
    try {
        const { uid } = req.query;
        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'uid is required' });
        }
        const customer = await Customer.findOne({ uid });
        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }
        await Customer.deleteOne({ uid });
        res.json({ status: 'success', message: 'Customer deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}

exports.updateCustomer = async (req, res) => {
    try {
        const { uid } = req.query;
        const { fname, lname, gender, email, userName, phoneNumber, address, city, state, country, pincode } = req.body;

        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'uid is required' });
        }

        const customer = await Customer.findOne({ uid });
        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        customer.fname = fname || customer.fname;
        customer.lname = lname || customer.lname;
        customer.gender = gender || customer.gender;
        customer.email = email || customer.email;
        customer.userName = userName || customer.userName;
        customer.phoneNumber = phoneNumber || customer.phoneNumber;
        customer.address = address || customer.address;
        customer.city = city || customer.city;
        customer.state = state || customer.state;
        customer.country = country || customer.country;
        customer.pincode = pincode || customer.pincode;
        await customer.save();

        res.json({ status: 'success', message: 'Customer updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getTotalCustomers = async (req, res) => {
    try {
        const totalCustomers = await Customer.countDocuments();
        res.json({ status: 'success', data: totalCustomers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};


