const Customer = require("../../models/Customers/profile/CustomerModel");
const Loan = require("../../models/Customers/Loans/LoanModel");
const RepaymentSchedule = require("../../models/Customers/Loans/Repayment/RepaymentScheduleModel");
const Repayment = require("../../models/Customers/Loans/Repayment/Repayments");
const Penalty = require("../../models/Customers/Loans/Repayment/PenaltyModel");
const { getSignedUrl, extractFilePath } = require('../../config/firebaseStorage');
const { generateRepaymentSchedule } = require('../../helpers/loan')

exports.search = async (req, res) => {
    const { query, page = 1, limit = 10 } = req.body;
    const skip = (page - 1) * limit;

    try {
        let searchQuery = {};

        if (query) {
            searchQuery.$or = [
                { fname: { $regex: query, $options: 'i' } },
                { lname: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { phoneNumber: { $regex: query, $options: 'i' } },
                { userName: { $regex: query, $options: 'i' } }
            ];
        }

        const customers = await Customer.find(searchQuery)
            .skip(skip)
            .limit(limit);

        const customerIds = customers.map(customer => customer._id);

        const loans = await Loan.find({ customer: { $in: customerIds } });

        // Create a map of customer IDs to their loans
        const customerLoansMap = loans.reduce((map, loan) => {
            if (!map[loan.customer.toString()]) {
                map[loan.customer.toString()] = [];
            }
            map[loan.customer.toString()].push(loan);
            return map;
        }, {});

        // Summarize customer data with embedded loans
        const summarizedCustomers = await Promise.all(customers.map(async (customer) => {
            const customerLoans = customerLoansMap[customer._id.toString()] || [];

            const summarizedLoans = await Promise.all(customerLoans.map(async (loan) => {
                const documentTypes = Object.keys(loan.documents).filter(key => loan.documents[key]);
                const repaymentSchedulesCount = await RepaymentSchedule.countDocuments({ loan: loan._id });
                const repaymentsCount = await Repayment.countDocuments({ loan: loan._id });
                const penaltiesCount = await Penalty.countDocuments({ loan: loan._id });

                return {
                    _id: loan._id,
                    loanAmount: loan.loanAmount,
                    status: loan.status,
                    loanStartDate: loan.loanStartDate,
                    loanEndDate: loan.loanEndDate,
                    outstandingAmount: loan.outstandingAmount,
                    documentsSummary: `${documentTypes.length} document types available`,
                    repaymentSchedulesSummary: `${repaymentSchedulesCount} repayment schedules`,
                    repaymentsSummary: `${repaymentsCount} repayments made`,
                    penaltiesSummary: `${penaltiesCount} penalties applied`,
                };
            }));

            return {
                _id: customer._id,
                uid: customer.uid,
                name: `${customer.fname} ${customer.lname}`,
                email: customer.email,
                phoneNumber: customer.phoneNumber,
                userName: customer.userName,
                profilePic: customer.profilePic ? await getSignedUrl(extractFilePath(customer.profilePic)) : null,
                loanCount: customerLoans.length,
                totalLoanAmount: customerLoans.reduce((sum, loan) => sum + loan.loanAmount, 0),
                loans: summarizedLoans,
            };
        }));

        const totalResults = await Customer.countDocuments(searchQuery);
        const totalPages = Math.ceil(totalResults / limit);

        res.status(200).json({
            status: "success",
            data: {
                customers: summarizedCustomers,
            },
            pagination: {
                currentPage: page,
                totalPages,
                totalResults,
                resultsPerPage: limit
            }
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            status: "error",
            message: "An error occurred while performing the search.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.loanDetailsCalculator = async (req, res) => {
    try {
        const {
            loanAmount,
            loanStartDate,
            loanDuration,
            installmentFrequency,
            gracePeriod = 0
        } = req.body;

        // Input validation
        if (!loanAmount || !loanStartDate || !loanDuration || !installmentFrequency) {
            return res.status(400).json({
                status: "error",
                message: "Missing required loan parameters"
            });
        }

        // Convert loanStartDate string to Date object
        const startDate = new Date(loanStartDate);

        // Prepare loan object for generateRepaymentSchedule
        const loan = {
            loanAmount: parseFloat(loanAmount),
            loanStartDate: startDate,
            loanDuration,
            installmentFrequency,
            gracePeriod: parseInt(gracePeriod)
        };

        // Generate repayment schedule
        const repaymentDetails = generateRepaymentSchedule(loan);

        // Prepare response without interest calculations
        const response = {
            loanAmount: loan.loanAmount,
            loanStartDate: loan.loanStartDate,
            loanEndDate: repaymentDetails.loanEndDate,
            loanDuration,
            installmentFrequency,
            gracePeriod: loan.gracePeriod,
            numberOfInstallments: repaymentDetails.numberOfInstallments,
            repaymentAmountPerInstallment: repaymentDetails.repaymentAmountPerInstallment,
            totalRepaymentAmount: repaymentDetails.totalRepaymentAmount,
            repaymentSchedule: repaymentDetails.schedule
        };

        res.status(200).json({
            status: "success",
            data: response
        });
    } catch (error) {
        console.error('Loan details calculation error:', error);
        res.status(500).json({
            status: "error",
            message: "An error occurred while calculating loan details.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
