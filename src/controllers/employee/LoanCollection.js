const Employee = require("../../models/Employee/EmployeeModel");
const Loan = require("../../models/Customers/Loans/LoanModel");
const RepaymentSchedule = require("../../models/Customers/Loans/Repayment/RepaymentScheduleModel");
const Repayment = require("../../models/Customers/Loans/Repayment/Repayments");
const Penalty = require("../../models/Customers/Loans/Repayment/PenaltyModel");
const Customer = require("../../models/Customers/profile/CustomerModel");
const moment = require('moment-timezone');

exports.collectionCountTody = async (req, res) => {
    try {
        let { date } = req.query;

        // If no date is provided, use the current date in IST
        if (!date) {
            date = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
        } else {
            // Validate the provided date
            if (!moment(date, 'YYYY-MM-DD', true).isValid()) {
                return res.status(400).json({ status: 'error', message: 'Invalid date format. Please use YYYY-MM-DD.' });
            }
        }

        const startOfDay = moment(date).tz('Asia/Kolkata').startOf('day').toDate();
        const endOfDay = moment(date).tz('Asia/Kolkata').endOf('day').toDate();

        // Get the count of collections due today
        const collectionCount = await RepaymentSchedule.countDocuments({
            dueDate: { $gte: startOfDay, $lte: endOfDay },
            status: { $in: ['Pending', 'PartiallyPaid', 'Overdue'] }
        });

        res.status(200).json({ status: 'success', count: collectionCount });
    } catch (error) {
        console.error('Collection error:', error);
        res.status(500).json({ status: 'error', message: "Error getting today's collection count" });
    }
};
exports.collectionsToBeCollectedToday = async (req, res) => {
    try {
        let { date } = req.query;

        // If no date is provided, use the current date in IST
        if (!date) {
            date = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
        } else {
            // Validate the provided date
            if (!moment(date, 'YYYY-MM-DD', true).isValid()) {
                return res.status(400).json({ status: 'error', message: 'Invalid date format. Please use YYYY-MM-DD.' });
            }
        }

        const startOfDay = moment(date).tz('Asia/Kolkata').startOf('day').toDate();
        const endOfDay = moment(date).tz('Asia/Kolkata').endOf('day').toDate();

        console.log(startOfDay, endOfDay);


        const collections = await RepaymentSchedule.find({
            dueDate: { $gte: startOfDay, $lte: endOfDay },
            status: { $in: ['Pending', 'PartiallyPaid', 'Overdue'] }
        }).populate({
            path: 'loan',
            select: 'customer loanAmount',
            populate: {
                path: 'customer',
                select: 'fname lname phoneNumber'
            }
        });

        res.status(200).json({ status: 'success', data: collections });
    } catch (error) {
        console.error('Collection error:', error);
        res.status(500).json({ status: 'error', message: "Error getting today's collections" });
    }
};

exports.payACustomerInstallment = async (req, res) => {
    try {
        const { loanId, repaymentScheduleId, amount, paymentMethod, transactionId } = req.body;

        console.log('Req User', req._id);
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        const repaymentSchedule = await RepaymentSchedule.findOne({
            loan: loanId,
            _id: repaymentScheduleId,
            status: { $in: ['Pending', 'PartiallyPaid', 'Overdue'] }
        }).sort({ dueDate: 1 });

        if (!repaymentSchedule) {
            return res.status(404).json({ status: 'error', message: 'No pending repayment schedule found' });
        }

        const newRepayment = new Repayment({
            repaymentSchedule: repaymentSchedule._id,
            amount,
            paymentMethod,
            transactionId,
            loan: loanId,
            balanceAfterPayment: loan.outstandingAmount - amount,
            collectedBy: req._id
        });

        await newRepayment.save();

        repaymentSchedule.status = amount >= repaymentSchedule.amount ? 'Paid' : 'PartiallyPaid';
        repaymentSchedule.paymentDate = Date.now();
        await repaymentSchedule.save();

        loan.totalPaid += amount;
        loan.outstandingAmount -= amount;
        await loan.save();

        res.status(200).json({ status: 'success', message: 'Payment processed successfully', data: newRepayment });
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ status: 'error', message: 'Error in paying installment' });
    }
};

exports.getCustomers = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;

        const skip = (page - 1) * limit;

        const customers = await Customer.find({}).skip(skip).limit(Number(limit)).populate({
            path: 'loans',
            select: 'loanAmount status loanStartDate loanEndDate outstandingAmount',
        });

        if (!customers) {
            return res.status(404).json({ status: 'error', message: 'Customers not found' });
        }

        if (customers.length === 0) {
            return res.status(200).json({ status: 'success', message: 'No customers found' });
        }

        const loanIds = customers.flatMap(customer => customer.loans.map(loan => loan._id));

        const repaymentSchedules = await RepaymentSchedule.find({ loan: { $in: loanIds } });
        const penalties = await Penalty.find({ loan: { $in: loanIds } });

        customers.forEach(customer => {
            customer.loans.forEach(loan => {
                loan.repaymentSchedules = repaymentSchedules.filter(schedule => schedule.loan.toString() === loan._id.toString());
                loan.penalty = penalties.find(penalty => penalty.loan.toString() === loan._id.toString()) || null;
            });
        });

        res.status(200).json({ status: 'success', data: customers });
    } catch (error) {
        console.error('Customer fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error in getting customers' });
    }
};

exports.getCustomerProfile = async (req, res) => {
    try {
        const { customerId } = req.query;

        const customer = await Customer.findById(customerId).populate({
            path: 'loans',
            select: 'loanAmount status loanStartDate loanEndDate outstandingAmount',
            populate: {
                path: 'repaymentSchedules',
                select: 'dueDate amount status'
            }
        });

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        res.status(200).json({ status: 'success', data: customer });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error in getting customer profile' });
    }
};

exports.getLoanDetails = async (req, res) => {
    try {
        const { loanId, limited, page = 1, limit = 10, includeCustomerProfile } = req.query;

        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        let query = RepaymentSchedule.find({ loan: loanId });

        if (limited === 'true') {
            const skip = (page - 1) * limit;
            query = query.skip(skip).limit(Number(limit));
        }

        const repaymentSchedules = await query.sort({ dueDate: 1 });

        let result = {
            loanDetails: loan,
            repaymentSchedules
        };

        if (includeCustomerProfile === 'true') {
            const customer = await Customer.findById(loan.customer);
            result.customerProfile = customer;
        }

        res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        console.error('Loan details fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error in getting loan details' });
    }
};

exports.applyPenaltyToALoanInstallment = async (req, res) => {
    try {
        const { loanId, penaltyAmount, repaymentScheduleId } = req.body;

        if (!loanId || !repaymentScheduleId || !penaltyAmount) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        const repaymentSchedule = await RepaymentSchedule.findById(repaymentScheduleId);
        if (!repaymentSchedule || repaymentSchedule.loan.toString() !== loanId) {
            return res.status(404).json({ status: 'error', message: 'Repayment schedule not found or does not belong to the specified loan' });
        }

        //Check if penalty is already applied
        if (repaymentSchedule.penaltyApplied) {
            return res.status(400).json({ status: 'error', message: 'Penalty already applied' });
        }

        const penalty = new Penalty({
            loan: loanId,
            repaymentSchedule: repaymentScheduleId,
            amount: penaltyAmount,
            reason: 'Late payment',
          
        });

        await penalty.save();

        repaymentSchedule.penaltyApplied = true;
        repaymentSchedule.penalty = penalty._id;
        repaymentSchedule.status = 'Overdue';
        await repaymentSchedule.save();

        loan.totalPenaltyAmmount += penaltyAmount;
        loan.totalPenalty.push(penalty._id);
        loan.outstandingAmount += penaltyAmount;
        await loan.save();

        res.status(200).json({ status: 'success', message: 'Penalty applied successfully', data: penalty });
    } catch (error) {
        console.error('Penalty application error:', error);
        res.status(500).json({ status: 'error', message: 'Error in applying penalty' });
    }
};

// New routes

exports.getTodaysOverdueLoans = async (req, res) => {
    try {
        const { date, page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const currentDate = moment().tz('Asia/Kolkata').startOf('day').toDate();

        const overdueLoans = await Loan.find({
            status: 'Active',
            outstandingAmount: { $gt: 0 }
        }).populate({
            path: 'customer',
            select: 'fname lname phoneNumber'
        }).populate({
            path: 'repaymentSchedules',
            match: { dueDate: { $lt: currentDate }, status: { $in: ['Pending', 'PartiallyPaid'] } }
        }).skip(skip).limit(Number(limit));

        const filteredOverdueLoans = overdueLoans.filter(loan => loan.repaymentSchedules.length > 0);

        res.status(200).json({ status: 'success', data: filteredOverdueLoans });
    } catch (error) {
        console.error('Overdue loans fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error in getting overdue loans' });
    }
};

exports.getLoanStatistics = async (req, res) => {
    try {
        const totalLoans = await Loan.countDocuments();
        const activeLoans = await Loan.countDocuments({ status: 'Active' });
        const totalOutstanding = await Loan.aggregate([
            { $match: { status: 'Active' } },
            { $group: { _id: null, total: { $sum: '$outstandingAmount' } } }
        ]);

        const statistics = {
            totalLoans,
            activeLoans,
            totalOutstanding: totalOutstanding[0]?.total || 0
        };

        res.status(200).json({ status: 'success', data: statistics });
    } catch (error) {
        console.error('Loan statistics fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error in getting loan statistics' });
    }
};

exports.getRepaymentHistory = async (req, res) => {
    try {
        const { loanId, page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const repayments = await Repayment.find({ loan: loanId })
            .sort({ paymentDate: -1 })
            .skip(skip)
            .limit(Number(limit))
            .populate('collectedBy', 'fname lname');

        res.status(200).json({ status: 'success', data: repayments });
    } catch (error) {
        console.error('Repayment history fetch error:', error);
        res.status(500).json({ status: 'error', message: 'Error in getting repayment history' });
    }
};