//src/controller/admin/customerController.js

const mongoose = require('mongoose');
const Customer = require('../../models/Customers/profile/CustomerModel');
const Loan = require('../../models/Customers/Loans/LoanModel');
const Penalty = require('../../models/Customers/Loans/Repayment/PenaltyModel');
const Repayment = require('../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Employee = require('../../models/Employee/EmployeeModel');
const { getSignedUrl, extractFilePath, uploadFile, deleteDocuments } = require('../../config/firebaseStorage');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const admin = require('firebase-admin');
const bucket = admin.storage().bucket();

exports.registerCustomer = async (req, res) => {
    try {
        const {
            fname, //Required
            lname, //Required
            gender, //Required
            email,
            userName,
            phoneNumber, //Required
            address,
            city,
            state,
            country,
            pincode,

        } = req.body;

        if (!fname || !lname || !phoneNumber || !gender) {
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

        let loanFields = 'loanAmount loanNumber businessFirmName businessAddress loanStartDate loanEndDate loanDuration totalPaid installmentFrequency numberOfInstallments assignedTo status';
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
                select: loanFields,
                populate: {
                    path: 'assignedTo',
                    select: 'uid fname lname'
                }
            });

        //Go through customer profilePic and replace it signed url
        for (let i = 0; i < customers.length; i++) {
            if (customers[i].profilePic) {
                const filePath = extractFilePath(customers[i].profilePic);
                customers[i].profilePic = await getSignedUrl(filePath);
            }
        }

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
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { uid } = req.query;
        if (!uid) {
            return res.status(400).json({ status: 'error', message: 'uid is required' });
        }

        const customer = await Customer.findOne({ uid }).populate('loans');
        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        // Check for active loans
        const activeLoans = customer.loans.filter(loan => loan.status === 'Active');
        if (activeLoans.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Customer has active loans and cannot be deleted' });
        }

        // Process each loan
        for (const loan of customer.loans) {
            // Delete documents from Firebase Storage and the database
            await deleteDocuments(loan._id);

            // Delete Repayment Schedule
            await RepaymentSchedule.deleteMany({ loan: loan._id }, { session });

            // Remove Repayment Collection from Employee
            const repayments = await Repayment.find({ loan: loan._id });
            const employee = await Employee.findById(loan.assignedTo);

            if (employee) {
                const repaymentIds = repayments.map(r => r._id.toString());
                employee.collectedRepayments = employee.collectedRepayments.filter(r => !repaymentIds.includes(r.toString()));
                await employee.save({ session });
            }

            // Delete Repayments 
            await Repayment.deleteMany({ loan: loan._id }, { session });

            // Delete Penalties
            await Penalty.deleteMany({ loan: loan._id }, { session });

            // Delete the loan
            await Loan.findByIdAndDelete(loan._id, { session });
        }

        // Delete customer's profile picture if it exists
        if (customer.profilePic) {
            const filePath = extractFilePath(customer.profilePic);
            await bucket.file(filePath).delete();
        }

        // Delete the customer
        await Customer.findByIdAndDelete(customer._id, { session });

        await session.commitTransaction();
        res.json({ status: 'success', message: 'Customer and associated data deleted successfully' });
    } catch (error) {
        await session.abortTransaction();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    } finally {
        session.endSession();
    }
};
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

        if (fname) {
            customer.fname = fname;
        }
        if (lname) {
            customer.lname = lname;
        }
        if (gender) {
            customer.gender = gender;
        }
        if (email) {
            customer.email = email;
        }
        if (userName) {
            customer.userName = userName;
        }
        if (phoneNumber) {
            customer.phoneNumber = phoneNumber;
        }
        if (address) {
            customer.address = address;
        }
        if (city) {
            customer.city = city;
        }
        if (state) {
            customer.state = state;
        }
        if (country) {
            customer.country = country;
        }
        if (pincode) {
            customer.pincode = pincode;
        }


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

exports.addProfilePicture = [
    upload.single('profilePic'),
    async (req, res) => {
        try {
            const { uid } = req.query;
            const file = req.file;

            if (!file) {
                return res.status(400).json({ status: 'error', message: 'file is required' });
            }

            const customer = await Customer.findOne({ uid });
            if (!customer) {
                return res.status(404).json({ status: 'error', message: 'Customer not found' });
            }

            // Delete the old profile picture if it exists
            if (customer.profilePic) {
                const oldFilePath = extractFilePath(customer.profilePic);
                try {
                    await bucket.file(oldFilePath).delete();
                } catch (error) {
                    console.error('Error deleting old profile picture:', error);
                }
            }

            // Upload the new profile picture
            const destination = `${uid}/profile`;
            try {
                const publicUrl = await uploadFile(file, destination);

                // Update the customer's profile picture URL in the database
                customer.profilePic = publicUrl;
                await customer.save();

                res.json({ status: 'success', message: 'Profile picture added successfully', url: publicUrl });
            } catch (error) {
                console.error('Error uploading file:', error);
                return res.status(500).json({ status: 'error', message: 'Error uploading file' });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }
];