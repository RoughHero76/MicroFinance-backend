const mongoose = require('mongoose');
const Loan = require('../../models/Customers/Loans/LoanModel');
const Customer = require('../../models/Customers/profile/CustomerModel');
const { generateRepaymentSchedule } = require('../../helpers/loan');


exports.createLoan = async (req, res) => {
    try {
        const {
            customerUid,
            loanAmount,
            principalAmount,
            loanDuration,
            installmentFrequency,
            interestRate,
            documents,
            loanStartDate
        } = req.body;

        // Validate required fields
        if (!customerUid || !loanAmount || !principalAmount || !loanDuration || !installmentFrequency || !interestRate || !documents || !loanStartDate) {
            return res.status(400).json({ status: 'error', message: 'All fields are required' });
        }

        // Validate loan duration
        if (!['100 days', '200 days', '300 days'].includes(loanDuration)) {
            return res.status(400).json({ status: 'error', message: 'Invalid loan duration' });
        }

        // Find the customer
        const customer = await Customer.findOne({ uid: customerUid });
        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        // Generate the repayment schedule
        const repaymentScheduleData = generateRepaymentSchedule({
            loanAmount,
            loanStartDate: new Date(loanStartDate),
            loanDuration,
            installmentFrequency,
            gracePeriod: 0 // Add any grace period logic here if necessary
        });

        // Create a new loan object
        const newLoan = new Loan({
            customer: customer._id,
            loanAmount,
            principalAmount,
            loanDuration,
            installmentFrequency,
            interestRate,
            documents,
            loanStartDate: new Date(loanStartDate),
            loanEndDate: repaymentScheduleData.loanEndDate,
            repaymentSchedule: repaymentScheduleData.schedule,
            repaymentAmountPerInstallment: repaymentScheduleData.schedule[0]?.amount || 0, // Repayment amount per installment
            numberOfInstallments: repaymentScheduleData.numberOfInstallments || repaymentScheduleData.schedule.length, // Number of installments
            outstandingAmount: repaymentScheduleData.outstandingAmount
        });

        // Save the loan to the customer's loan list
        customer.loans.push(newLoan._id);

        // Save both the loan and the customer
        await newLoan.save();
        await customer.save();

        // Respond with the created loan
        res.status(201).json({ status: 'success', loan: newLoan });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    }
};

exports.deleteLoan = async (req, res) => {
    try {
        const { loanId } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'loanId is required' });
        }

        const loan = await Loan.findById(loanId);

        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        console.log(loan.customer);

        const customer = await Customer.findById(loan.customer);

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        customer.loans = customer.loans.filter(l => l.toString() !== loanId);

        await Customer.findByIdAndUpdate(customer._id, { $set: { loans: customer.loans } });

        await Loan.findByIdAndDelete(loanId);

        res.json({ status: 'success', message: 'Loan deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getLoans = async (req, res) => {
    try {
        const { customerUid, status, loanId } = req.query;
        let query = {};

        if (customerUid) {
            const customer = await Customer.findOne({ uid: customerUid });
            if (customer) {
                query.customer = customer._id;
            } else {
                return res.status(404).json({ status: 'error', message: 'Customer not found' });
            }
        }
        if (status) {
            query.status = status;
        }
        if (loanId) {
            query._id = loanId;
        }

        const loans = await Loan.find(query).populate('customer', 'fname lname phoneNumber');
        res.json({ status: 'success', data: loans });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getRepaymentSchedule = async (req, res) => {
    try {
        const { loanId, searchTerm, statusFilter, dateFrom, dateTo } = req.query;
        const { page = 1, limit = 10 } = req.query; // Pagination params with defaults
        
        // Validate loanId
        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'Loan ID is required' });
        }
        
        // Find the loan by loanId
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }
        
        // Get the repayment schedule and apply filters
        let repaymentSchedule = loan.repaymentSchedule;
        
        // Apply search filter
        if (searchTerm) {
            const searchRegex = new RegExp(searchTerm, 'i');
            repaymentSchedule = repaymentSchedule.filter(item =>
                searchRegex.test(item.dueDate.toISOString()) ||
                searchRegex.test(item.amount.toString()) ||
                searchRegex.test(item.status)
            );
        }
        
        // Apply status filter
        if (statusFilter) {
            repaymentSchedule = repaymentSchedule.filter(item =>
                item.status.toLowerCase() === statusFilter.toLowerCase()
            );
        }
        
        // Apply date range filter
        if (dateFrom || dateTo) {
            const fromDate = dateFrom ? new Date(dateFrom) : new Date('1900-01-01');
            const toDate = dateTo ? new Date(dateTo) : new Date('9999-12-31');
            repaymentSchedule = repaymentSchedule.filter(item => {
                const itemDate = new Date(item.dueDate);
                return itemDate >= fromDate && itemDate <= toDate;
            });
        }
        
        // Implement pagination logic
        const total = repaymentSchedule.length; // Total number of repayment schedule entries
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedSchedule = repaymentSchedule.slice(startIndex, endIndex);
        
        // Send paginated response
        res.json({
            status: 'success',
            data: {
                repaymentSchedule: paginatedSchedule,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalEntries: total
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};





exports.getCountofLoans = async (req, res) => {
    try {
        const count = await Loan.countDocuments();
        res.json({ status: 'success', count });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getTotalMarketDetails = async (req, res) => {
    try {
        const totalMarketAmmount = await Loan.aggregate([
            { $group: { _id: null, totalMarketAmmount: { $sum: '$loanAmount' } } }
        ]);

        // Get the total ammount repaid

        const totalMarketAmmountRepaid = await Loan.aggregate([
            { $group: { _id: null, totalMarketAmmountRepaid: { $sum: '$totalPaid' } } }
        ]);

        res.json({ status: 'success', data: { totalMarketAmmount: totalMarketAmmount[0].totalMarketAmmount, totalMarketAmmountRepaid: totalMarketAmmountRepaid[0].totalMarketAmmountRepaid } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

