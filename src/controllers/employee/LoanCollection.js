const Employee = require("../../models/Employee/EmployeeModel");
const Loan = require("../../models/Customers/Loans/LoanModel");
const RepaymentSchedule = require("../../models/Customers/Loans/Repayment/RepaymentScheduleModel");
const Repayment = require("../../models/Customers/Loans/Repayment/Repayments");
const Penalty = require("../../models/Customers/Loans/Repayment/PenaltyModel");
const Customer = require("../../models/Customers/profile/CustomerModel");
const moment = require('moment-timezone');
const { getSignedUrl, extractFilePath, uploadFile } = require('../../config/firebaseStorage');
const mongoose = require('mongoose');

exports.collectionCountToday = async (req, res) => {
    try {
        let { date } = req.query;
        const id = req._id;

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
        const collectionCount = await RepaymentSchedule.aggregate([
            {
                $match: {
                    dueDate: { $gte: startOfDay, $lte: endOfDay },
                    status: { $in: ['Pending', 'PartiallyPaid', 'Overdue'] }
                }
            },
            {
                $lookup: {
                    from: 'loans',
                    localField: 'loan',
                    foreignField: '_id',
                    as: 'loanDetails'
                }
            },
            {
                $unwind: '$loanDetails'
            },
            {
                $match: {
                    'loanDetails.assignedTo': new mongoose.Types.ObjectId(id)
                }
            },
            {
                $count: 'totalCount'
            }
        ]);

        const count = collectionCount.length > 0 ? collectionCount[0].totalCount : 0;

        res.status(200).json({ status: 'success', count });
    } catch (error) {
        console.error('Collection error:', error);
        res.status(500).json({ status: 'error', message: "Error getting today's collection count" });
    }
};

exports.collectionsToBeCollectedToday = async (req, res) => {
    try {
        const id = req._id;
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

        const collections = await RepaymentSchedule.aggregate([
            {
                $lookup: {
                    from: 'loans',
                    localField: 'loan',
                    foreignField: '_id',
                    as: 'loanDetails'
                }
            },
            {
                $unwind: '$loanDetails'
            },
            {
                $match: {
                    'loanDetails.assignedTo': new mongoose.Types.ObjectId(id),
                    $or: [
                        // Collections due today
                        {
                            dueDate: { $gte: startOfDay, $lte: endOfDay },
                            status: { $in: ['Pending', 'PartiallyPaid', 'Overdue'] }
                        },
                        // Oldest pending schedule for loans past end date
                        {
                            'loanDetails.loanEndDate': { $lt: startOfDay },
                            status: { $in: ['Pending', 'PartiallyPaid', 'Overdue'] }
                        }
                    ]
                }
            },
            {
                $sort: { dueDate: 1 } // Sort by dueDate to get the oldest schedule first
            },
            {
                $group: {
                    _id: '$loan',
                    schedules: { $push: '$$ROOT' },
                    oldestSchedule: { $first: '$$ROOT' }
                }
            },
            {
                $replaceRoot: {
                    newRoot: {
                        $cond: [
                            { $lt: ['$oldestSchedule.loanDetails.loanEndDate', startOfDay] },
                            '$oldestSchedule',
                            { $arrayElemAt: ['$schedules', 0] }
                        ]
                    }
                }
            },
            {
                $lookup: {
                    from: 'customers',
                    localField: 'loanDetails.customer',
                    foreignField: '_id',
                    as: 'customerDetails'
                }
            },
            {
                $unwind: '$customerDetails'
            },
            {
                // Fetch all overdue amounts including today's schedules
                $lookup: {
                    from: 'repaymentschedules',
                    localField: 'loan',
                    foreignField: 'loan',
                    as: 'allSchedules'
                }
            },
            {
                $addFields: {
                    totalOverdueAmount: {
                        $sum: {
                            $map: {
                                input: '$allSchedules',
                                as: 'schedule',
                                in: {
                                    $cond: [
                                        { $and: [{ $lte: ['$$schedule.dueDate', endOfDay] }, { $in: ['$$schedule.status', ['Pending', 'PartiallyPaid', 'Overdue']] }] },
                                        '$$schedule.amount',
                                        0
                                    ]
                                }
                            }
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 1,
                    dueDate: 1,
                    amount: 1,
                    status: 1,
                    loanInstallmentNumber: 1,
                    loan: {
                        _id: '$loanDetails._id',
                        loanAmount: '$loanDetails.loanAmount',
                        loanEndDate: '$loanDetails.loanEndDate',
                        totalOverdueAmount: '$totalOverdueAmount',
                        customer: {
                            _id: '$customerDetails._id',
                            fname: '$customerDetails.fname',
                            lname: '$customerDetails.lname',
                            phoneNumber: '$customerDetails.phoneNumber'
                        }
                    }
                }
            }
        ]);

        res.status(200).json({ status: 'success', data: collections });
    } catch (error) {
        console.error('Collection error:', error);
        res.status(500).json({ status: 'error', message: "Error getting today's collections" });
    }
};


exports.payACustomerInstallment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { loanId, repaymentScheduleId, amount, paymentMethod, transactionId } = req.body;
        const collectedBy = req._id;
        let remainingAmount = amount;
        const logicNoteDetails = [];
        const schedulesToUpdate = [];

        // 1. Validate loan exists
        const loan = await Loan.findById(loanId).session(session);
        if (!loan) {
            throw new Error('Loan not found');
        }

        // 2. Get current schedule (today's schedule)
        const currentSchedule = await RepaymentSchedule.findOne({
            loan: loanId,
            _id: repaymentScheduleId,
            status: { $in: ['Pending', 'PartiallyPaid'] }
        }).session(session);

        if (!currentSchedule) {
            throw new Error('No valid repayment schedule found for today');
        }

        const scheduleAmount = currentSchedule.originalAmount || currentSchedule.amount;

        // 3. Initial validation
        if (amount < scheduleAmount / 2) {
            throw new Error('Payment must be at least half of the scheduled amount');
        }

        // 4. Create repayment record and save it to generate _id
        const newRepayment = new Repayment({
            repaymentSchedule: [],
            amount: amount,
            paymentMethod,
            transactionId,
            loan: loanId,
            collectedBy,
            logicNote: ''
        });
        await newRepayment.save({ session });

        // 5. Process current schedule
        if (remainingAmount >= scheduleAmount / 2) {
            const isFullPayment = remainingAmount >= scheduleAmount;
            currentSchedule.status = isFullPayment ? 'Paid' : 'PartiallyPaid';
            currentSchedule.amount = isFullPayment ? scheduleAmount : remainingAmount;
            currentSchedule.paymentDate = Date.now();
            currentSchedule.repayments.push(newRepayment._id);
            currentSchedule.collectedBy = collectedBy;
            newRepayment.repaymentSchedule.push(currentSchedule._id);

            logicNoteDetails.push(`Schedule ${currentSchedule._id}: ${isFullPayment ? 'Full' : 'Partial'} payment - ${isFullPayment ? scheduleAmount : remainingAmount}`);
            remainingAmount -= isFullPayment ? scheduleAmount : remainingAmount;

            schedulesToUpdate.push(currentSchedule);
        }

        // 6. Process overdue schedules
        if (remainingAmount >= scheduleAmount) {
            const overdueSchedules = await RepaymentSchedule.find({
                loan: loanId,
                status: 'Overdue',
                _id: { $ne: repaymentScheduleId }
            }).sort({ dueDate: 1 }).session(session);

            for (const schedule of overdueSchedules) {
                if (remainingAmount < scheduleAmount) break;

                schedule.status = 'OverduePaid';
                schedule.paymentDate = Date.now();
                schedule.repayments.push(newRepayment._id);
                schedule.collectedBy = collectedBy;
                newRepayment.repaymentSchedule.push(schedule._id);

                remainingAmount -= scheduleAmount;
                logicNoteDetails.push(`Schedule ${schedule._id}: Overdue paid`);

                schedulesToUpdate.push(schedule);
            }
        }

        // 7. Process partially paid schedules
        let partialPaymentsMade = false;
        if (remainingAmount >= scheduleAmount / 2) {
            const partiallyPaidSchedules = await RepaymentSchedule.find({
                loan: loanId,
                status: 'PartiallyPaid',
                _id: { $ne: repaymentScheduleId }
            }).sort({ dueDate: 1 }).session(session);

            for (const schedule of partiallyPaidSchedules) {
                const remainingScheduleAmount = scheduleAmount - schedule.amount;
                if (remainingAmount < remainingScheduleAmount) break;

                schedule.status = 'PartiallyPaidFullyPaid';
                schedule.amount = scheduleAmount;
                schedule.paymentDate = Date.now();
                schedule.repayments.push(newRepayment._id);
                schedule.collectedBy = collectedBy;
                newRepayment.repaymentSchedule.push(schedule._id);

                remainingAmount -= remainingScheduleAmount;
                logicNoteDetails.push(`Schedule ${schedule._id}: Partially paid amount now fully paid`);
                partialPaymentsMade = true;

                schedulesToUpdate.push(schedule);
            }
        }

        // 8. Handle remaining amount
        if (remainingAmount > 0) {
            // Case 1: Remaining amount is less than a full schedule
            if (remainingAmount < scheduleAmount) {
                if (partialPaymentsMade) {
                    throw new Error('Cannot have remaining partial amount after completing partial payments');
                }

                if (remainingAmount === scheduleAmount / 2) {
                    throw new Error('Cannot make advance partial payment');
                }

                throw new Error('Remaining amount must be zero or a full schedule amount');
            }

            if (remainingAmount % scheduleAmount !== 0) {
                throw new Error('Remaining amount for advance payment must be a multiple of the schedule amount');
            }

            // Process advance payments
            const futureSchedules = await RepaymentSchedule.find({
                loan: loanId,
                status: 'Pending',
                dueDate: { $gt: new Date() }
            }).sort({ dueDate: 1 }).session(session);

            if (futureSchedules.length * scheduleAmount < remainingAmount) {
                throw new Error('Not enough future schedules for advance payment');
            }

            for (const schedule of futureSchedules) {
                if (remainingAmount < scheduleAmount) break;

                schedule.status = 'AdvancePaid';
                schedule.paymentDate = Date.now();
                schedule.repayments.push(newRepayment._id);
                schedule.collectedBy = collectedBy;
                newRepayment.repaymentSchedule.push(schedule._id);

                remainingAmount -= scheduleAmount;
                logicNoteDetails.push(`Schedule ${schedule._id}: Advance paid`);

                schedulesToUpdate.push(schedule);
            }
        }

        // 9. Ensure all amount is processed
        if (remainingAmount > 0) {
            throw new Error('Unable to process all payment amount');
        }

        // 10. Save all modified repayment schedules
        const savePromises = schedulesToUpdate.map(schedule => schedule.save({ session }));
        await Promise.all(savePromises);

        // 11. Update loan
        loan.totalPaid += amount;
        loan.outstandingAmount -= amount;
        await loan.save({ session });

        // 12. Update employee
        const employee = await Employee.findById(collectedBy).session(session);
        employee.collectedRepayments.push(newRepayment._id);
        await employee.save({ session });

        // 13. Finalize and save repayment
        newRepayment.logicNote = logicNoteDetails.join(' | ');
        await newRepayment.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            status: 'success',
            message: 'Payment processed successfully',
            data: {
                repaymentDetails: newRepayment,
                updatedSchedules: schedulesToUpdate.length
            }
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Payment error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.getCustomers = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const employeeId = req._id; // Assuming employee ID comes from req._id

        const skip = (page - 1) * limit;

        // Fetch customers whose loans are assigned to this employee
        const customers = await Customer.find({})
            .skip(skip)
            .limit(Number(limit))
            .select('fname lname email phoneNumber address city profilePic')
            .populate({
                path: 'loans',
                match: { assignedTo: employeeId }, // Filter loans assigned to this employee
                select: 'loanAmount status loanStartDate loanEndDate outstandingAmount',
            });

        if (!customers || customers.length === 0) {
            return res.status(200).json({ status: 'success', message: 'No customers found' });
        }

        for (let i = 0; i < customers.length; i++) {
            if (customers[i].profilePic) {
                const filePath = extractFilePath(customers[i].profilePic);
                customers[i].profilePic = await getSignedUrl(filePath);
            }
        }

        // Filter customers who have loans assigned to the employee
        const filteredCustomers = customers
            .filter(customer => customer.loans.length > 0) // Only customers with loans assigned to the employee
            .map(customer => ({
                _id: customer._id,
                fname: customer.fname,
                lname: customer.lname,
                profilePic: customer.profilePic,
                email: customer.email,
                phoneNumber: customer.phoneNumber,
                address: customer.address,
                city: customer.city,
                loans: customer.loans.map(loan => ({
                    loanAmount: loan.loanAmount,
                    status: loan.status,
                    loanStartDate: loan.loanStartDate,
                    loanEndDate: loan.loanEndDate,
                    outstandingAmount: loan.outstandingAmount,
                }))
            }));

        res.status(200).json({ status: 'success', data: filteredCustomers });
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
            select: 'loanAmount status loanStartDate loanEndDate outstandingAmount phoneNumber address city, profilePic',

        });

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        const filePath = extractFilePath(customer.profilePic);
        customer.profilePic = await getSignedUrl(filePath);

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
        repaymentSchedule.penaltyAmount = penaltyAmount;
        await repaymentSchedule.save();
        //No need to make modifications to loan is there are pre-save available in penalty
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