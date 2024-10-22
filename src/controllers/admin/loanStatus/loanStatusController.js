const LoanStatus = require('../../../models/Customers/Loans/loanStatusModel');
const Loan = require('../../../models/Customers/Loans/LoanModel');
const Customer = require('../../../models/Customers/profile/CustomerModel');
const RepaymentSchedule = require('../../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const mongoose = require('mongoose');

exports.getLoanStatus = async (req, res) => {
    try {
        const {
            smaLevel, npa, loanId, customerId, assignedTo,
            minOverdue, maxOverdue,
            page = 1, limit = 10, sortBy = 'smaDate', sortOrder = 'desc',
            includeCustomer = 'false', 
            includeRepaymentSchedule = 'false' 
        } = req.query;

        const query = {};
        const pageNumber = parseInt(page); // Convert to number
        const limitNumber = parseInt(limit); // Convert to number

        // Basic filters
        if (smaLevel) query.smaLevel = smaLevel;
        if (npa) query.npa = npa === 'true';
        if (loanId) query.loan = loanId;
        if (minOverdue) query.totalOverdue = { $gte: parseFloat(minOverdue) };
        if (maxOverdue) query.totalOverdue = { ...query.totalOverdue, $lte: parseFloat(maxOverdue) };

        // Handle assignedTo filter
        if (assignedTo === 'me') {
            const loans = await Loan.find({ assignedTo: req._id }).select('_id');
            query.loan = { $in: loans.map(loan => loan._id) };
        } else if (assignedTo) {
            const loans = await Loan.find({ assignedTo }).select('_id');
            query.loan = { $in: loans.map(loan => loan._id) };
        }

        // Handle customerId filter
        if (customerId) {
            const customerLoans = await Loan.find({ customer: customerId }).select('_id');
            query.loan = { $in: customerLoans.map(loan => loan._id) };
        }

        // Get total count before pagination
        const total = await LoanStatus.countDocuments(query);

        // Pagination
        const skip = (pageNumber - 1) * limitNumber;

        // Sorting
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Base query for loan status
        let loanStatusQuery = LoanStatus.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limitNumber);

        // Conditional population based on query params
        if (includeRepaymentSchedule === 'true') {
            loanStatusQuery = loanStatusQuery.populate('repaymentSchedules');
        }

        if (includeCustomer === 'true') {
            loanStatusQuery = loanStatusQuery.populate({
                path: 'loan',
                select: 'loanNumber loanAmount principalAmount loanDuration installmentFrequency numberOfInstallments loanStartDate loanEndDate totalPaid businessAddress',
                populate: {
                    path: 'customer',
                    select: 'fname lname email phoneNumber address city'
                }
            });
        } else {
            loanStatusQuery = loanStatusQuery.populate({
                path: 'loan',
                select: 'loanNumber loanAmount principalAmount loanDuration installmentFrequency numberOfInstallments loanStartDate loanEndDate totalPaid businessAddress'
            });
        }

        const loanStatus = await loanStatusQuery;

        res.status(200).json({
            status: 'success',
            data: loanStatus,
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(total / limitNumber),
                totalResults: total
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
    }
};

exports.getLoanStatusStatistics = async (req, res) => {
    try {
        const stats = await LoanStatus.aggregate([
            // First stage: Group and calculate counts
            {
                $facet: {
                    // Overall statistics
                    'overallStats': [
                        {
                            $group: {
                                _id: null,
                                totalLoans: { $sum: 1 },
                                totalOverdue: { $sum: '$totalOverdue' },
                                totalNPA: {
                                    $sum: { $cond: ['$npa', 1, 0] }
                                },
                                totalNonNPA: {
                                    $sum: { $cond: ['$npa', 0, 1] }
                                }
                            }
                        }
                    ],
                    // SMA level breakdown
                    'smaStats': [
                        {
                            $group: {
                                _id: '$smaLevel',
                                count: { $sum: 1 },
                                totalOverdue: { $sum: '$totalOverdue' }
                            }
                        }
                    ],
                    // Default type breakdown
                    'defaultStats': [
                        {
                            $group: {
                                _id: '$defaults',
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // Monthly trend
                    'monthlyTrend': [
                        {
                            $group: {
                                _id: {
                                    year: { $year: '$smaDate' },
                                    month: { $month: '$smaDate' }
                                },
                                averageOverdue: { $avg: '$totalOverdue' },
                                countNPA: {
                                    $sum: { $cond: ['$npa', 1, 0] }
                                },
                                countLoans: { $sum: 1 }
                            }
                        },
                        { $sort: { '_id.year': -1, '_id.month': -1 } },
                        { $limit: 12 }
                    ]
                }
            },
            // Second stage: Format the response
            {
                $project: {
                    statistics: {
                        overall: { $arrayElemAt: ['$overallStats', 0] },
                        smaLevels: {
                            $map: {
                                input: '$smaStats',
                                as: 'sma',
                                in: {
                                    level: '$$sma._id',
                                    count: '$$sma.count',
                                    totalOverdue: '$$sma.totalOverdue'
                                }
                            }
                        },
                        defaults: {
                            $map: {
                                input: '$defaultStats',
                                as: 'def',
                                in: {
                                    type: '$$def._id',
                                    count: '$$def.count'
                                }
                            }
                        },
                        monthlyTrend: '$monthlyTrend'
                    }
                }
            }
        ]);

        // Calculate percentages and format response
        const formattedStats = stats[0];
        if (formattedStats.statistics.overall) {
            const totalLoans = formattedStats.statistics.overall.totalLoans;
            
            // Add percentages to SMA levels
            formattedStats.statistics.smaLevels = formattedStats.statistics.smaLevels.map(level => ({
                ...level,
                percentage: ((level.count / totalLoans) * 100).toFixed(2)
            }));

            // Add NPA percentage
            formattedStats.statistics.overall.npaPercentage = 
                ((formattedStats.statistics.overall.totalNPA / totalLoans) * 100).toFixed(2);
        }

        res.status(200).json({
            status: 'success',
            data: formattedStats
        });

    } catch (error) {
        console.error('Error in getLoanStatusStatistics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch loan statistics',
            error: error.message
        });
    }
};