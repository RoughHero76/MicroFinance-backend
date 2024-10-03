const mongoose = require('mongoose');
const { getStorage } = require('firebase-admin/storage');
const Loan = require('../../../models/Customers/Loans/LoanModel');
const Repayment = require('../../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Document = require('../../../models/Customers/Loans/DocumentsModel');
const Employee = require('../../../models/Employee/EmployeeModel');
const Penalty = require('../../../models/Customers/Loans/Repayment/PenaltyModel');
const Customer = require('../../../models/Customers/profile/CustomerModel');
const { generateRepaymentSchedule } = require('../../../helpers/loan');
const { getSignedUrl, extractFilePath, uploadFile, deleteDocuments } = require('../../../config/firebaseStorage');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

exports.createLoan = [
    upload.any(),
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            console.log('Incoming request', { body: req.body, files: req.files });

            const {
                customerUid,
                loanAmount,
                principalAmount,
                loanDuration,
                installmentFrequency,
                interestRate,
                loanStartDate,
                gracePeriod,
                documents,
                loanNumber,
                businessFirmName,
                businessAddress,
                businessPhone,
                businessEmail
            } = req.body;

            const parsedDocuments = JSON.parse(documents);

            console.log('Parsed request body', {
                customerUid,
                loanAmount,
                principalAmount,
                loanDuration,
                installmentFrequency,
                interestRate,
                loanStartDate,
                gracePeriod,
                parsedDocuments
            });

            // Validation checks (keep existing validation logic)

            const customer = await Customer.findOne({ uid: customerUid }).session(session);
            console.log('Customer found:', customer);

            if (!customer) {
                console.log('Customer not found with UID:', customerUid);
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ status: 'error', message: 'Customer not found' });
            }

            const parsedBody = {
                ...req.body,
                loanAmount: parseFloat(loanAmount),
                loanNumber: parseInt(loanNumber),
                principalAmount: parseFloat(principalAmount),
                interestRate: parseFloat(interestRate),
                gracePeriod: parseInt(gracePeriod) || 0
            };

            // Generate repayment schedule
            const repaymentScheduleData = generateRepaymentSchedule({
                loanAmount: parsedBody.loanAmount,
                loanStartDate: new Date(parsedBody.loanStartDate),
                loanDuration: parsedBody.loanDuration,
                installmentFrequency: parsedBody.installmentFrequency,
                gracePeriod: parsedBody.gracePeriod
            });

            // Create a new loan document
            const newLoan = new Loan({
                customer: customer._id,
                loanAmount: parsedBody.loanAmount,
                principalAmount: parsedBody.principalAmount,
                loanDuration: parsedBody.loanDuration,
                installmentFrequency: parsedBody.installmentFrequency,
                interestRate: parsedBody.interestRate,
                loanStartDate: new Date(parsedBody.loanStartDate),
                numberOfInstallments: repaymentScheduleData.numberOfInstallments,
                loanEndDate: repaymentScheduleData.loanEndDate,
                repaymentAmountPerInstallment: repaymentScheduleData.schedule[0]?.amount || 0,
                outstandingAmount: parsedBody.loanAmount,
                loanNumber: parsedBody.loanNumber,
                businessFirmName: businessFirmName,
                businessAddress: businessAddress,
                businessPhone: businessPhone,
                businessEmail: businessEmail


            });

            await newLoan.save({ session });

            // Function to upload file with the new path structure
            const uploadFileWithPath = async (file, documentName) => {
                const path = `${customerUid}/${newLoan._id}/${documentName}`;
                return await uploadFile(file, path);
            };

            // Upload documents
            for (const doc of parsedDocuments) {
                const file = req.files.find(f => f.fieldname === doc.fieldname);
                if (file) {
                    const documentUrl = await uploadFileWithPath(file, doc.documentName);
                    const newDocument = new Document({
                        loan: newLoan._id,
                        documentName: doc.documentName,
                        documentUrl: documentUrl,
                        documentType: doc.documentType
                    });
                    await newDocument.save({ session });
                    newLoan.documents.push(newDocument._id);
                }
            }

            // Create RepaymentSchedule documents
            const repaymentSchedules = await Promise.all(repaymentScheduleData.schedule.map(async (scheduleItem, index) => {
                const repaymentSchedule = new RepaymentSchedule({
                    loan: newLoan._id,
                    dueDate: scheduleItem.dueDate,
                    amount: scheduleItem.amount,
                    originalAmount: scheduleItem.amount,
                    loanInstallmentNumber: index + 1
                });
                await repaymentSchedule.save({ session });
                return repaymentSchedule._id;
            }));

            newLoan.repaymentSchedules = repaymentSchedules;
            await newLoan.save({ session });
            customer.loans.push(newLoan._id);
            await customer.save({ session });

            await session.commitTransaction();
            session.endSession();

            res.status(201).json({ status: 'success', loan: newLoan });
        } catch (error) {
            console.error(error);
            await session.abortTransaction();
            session.endSession();
            res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
        }
    }
];


exports.deleteLoan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { loanId, force } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'loanId is required' });
        }

        const loan = await Loan.findById(loanId).populate('documents');

        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        const customer = await Customer.findById(loan.customer);

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        if (force !== 'true' && loan.status === 'Active') {
            return res.status(400).json({ status: 'error', message: 'Loan is active. Cannot delete it.' });
        }

        // Delete documents from Firebase Storage and the database
        await deleteDocuments(loanId);

        // Remove loan reference from customer
        customer.loans = customer.loans.filter(l => l.toString() !== loanId);
        await customer.save({ session });

        // Delete Repayment Schedule
        await RepaymentSchedule.deleteMany({ loan: loanId }, { session });

        // Remove Repayment Collection from Employee
        const repayments = await Repayment.find({ loan: loanId });
        const employee = await Employee.findById(loan.assignedTo);

        if (employee) {
            // Filter out repayments based on their ObjectIds
            const repaymentIds = repayments.map(r => r._id.toString());
            employee.collectedRepayments = employee.collectedRepayments.filter(r => !repaymentIds.includes(r.toString()));
            await employee.save({ session });
        }

        // Delete Repayments 
        await Repayment.deleteMany({ loan: loanId }, { session });

        // Delete Penalties
        await Penalty.deleteMany({ loan: loanId }, { session });

        // Delete the loan
        await Loan.findByIdAndDelete(loanId, { session });

        // Delete Collected Collection History in Employee Collection
        // (You may need to implement this part based on your specific requirements)

        await session.commitTransaction();
        res.json({ status: 'success', message: 'Loan and associated documents deleted successfully' });
    } catch (error) {
        await session.abortTransaction();
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    } finally {
        session.endSession();
    }
};
exports.getLoans = async (req, res) => {
    try {
        const {
            customerUid,
            status,
            loanId,
            includeRepaymentSchedule,
            includeRepaymentHistory,
            includeCustomerProfile,
            limitedLoanDetails,
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        console.log('getLoans - req.query: ', req.query);

        let query = {};
        let select = '';
        let populateOptions = [];

        // Filter by limited loan details
        if (limitedLoanDetails === 'true') {
            select = 'uid loanAmount status loanStartDate loanEndDate';
        }

        // Filter by customer UID
        if (customerUid) {
            const customer = await Customer.findOne({ uid: customerUid });
            if (customer) {
                query.customer = customer._id;
            } else {
                return res.status(404).json({ status: 'error', message: 'Customer not found' });
            }
        }

        // Filter by status
        if (status) {
            query.status = status;
        }

        // Filter by loan ID
        if (loanId) {
            query._id = loanId;
        }

        // Include customer profile
        if (includeCustomerProfile === 'true') {
            populateOptions.push({
                path: 'customer',
                select: 'uid fname lname phoneNumber'
            });
        }

        // Include documents
        populateOptions.push({
            path: 'documents',
            select: 'uid documentName documentUrl documentType status'
        });

        // Pagination
        const skip = (page - 1) * limit;

        // Sorting
        const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

        // Execute query
        let loans = await Loan.find(query)
            .select(select)
            .populate(populateOptions)
            .sort(sort)
            .skip(skip)
            .limit(Number(limit));

        // Generate signed URLs for documents
        loans = await Promise.all(loans.map(async (loan) => {
            loan = loan.toObject();
            if (loan.documents && loan.documents.length > 0) {
                loan.documents = await Promise.all(loan.documents.map(async (doc) => {
                    if (doc.documentUrl) {
                        try {
                            doc.documentUrl = await getSignedUrl(doc.documentUrl);
                        } catch (error) {
                            console.error(`Error generating signed URL for document ${doc.uid}:`, error);
                            doc.documentUrl = null;
                        }
                    }
                    return doc;
                }));
            }
            return loan;
        }));

        // Get total count for pagination
        const totalLoans = await Loan.countDocuments(query);

        // Include repayment schedule
        if (includeRepaymentSchedule === 'true') {
            loans = await Promise.all(loans.map(async (loan) => {
                loan.repaymentSchedule = await RepaymentSchedule.find({ loan: loan._id })
                    .select('dueDate amount status penaltyApplied penalty')
                    .sort({ dueDate: 1 });
                return loan;
            }));
        }

        // Include repayment history
        if (includeRepaymentHistory === 'true') {
            loans = await Promise.all(loans.map(async (loan) => {
                const repaymentSchedules = await RepaymentSchedule.find({ loan: loan._id });
                loan.repaymentHistory = await Repayment.find({
                    repaymentSchedule: { $in: repaymentSchedules.map(rs => rs._id) }
                })
                    .select('amount paymentDate status')
                    .sort({ paymentDate: -1 });
                return loan;
            }));
        }

        res.json({
            status: 'success',
            data: loans,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(totalLoans / limit),
                totalItems: totalLoans,
                itemsPerPage: Number(limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

// New function to delete documents
exports.deleteDocuments = async (req, res) => {
    try {
        const { loanId } = req.params;
        const { documentIds } = req.body;

        const result = await deleteDocuments(loanId, documentIds);
        res.json({ status: 'success', ...result });
    } catch (error) {
        console.error('Error in deleteDocuments controller:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
};


exports.approveLoan = async (req, res) => {

    try {
        const { loanId } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'loandId is required' })
        }

        const loan = await Loan.findById(loanId);

        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        if (loan.status === 'Approved' || loan.status === 'Active') {
            return res.status(400).json({ status: 'error', message: 'Loan already approved or active' });
        }

        if (loan.status === 'Rejected') {
            return res.status(400).json({ status: 'error', message: 'Loan already rejected' });
        }

        const customer = await Customer.findById(loan.customer);

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }
        loan.status = 'Active';
        await loan.save();
        res.json({ status: 'success', message: 'Loan approved successfully', data: loan });



    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }

}

exports.rejectLoan = async (req, res) => {

    try {
        const { loanId } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'loandId is required' })
        }

        const loan = await Loan.findById(loanId);

        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        if (loan.status === 'Rejected') {
            return res.status(400).json({ status: 'error', message: 'Loan already rejected' });
        }

        if (loan.status === 'Approved' || loan.status === 'Active') {
            return res.status(400).json({ status: 'error', message: 'Loan already approved' });
        }

        const customer = await Customer.findById(loan.customer);

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }
        await RepaymentSchedule.deleteMany({ loan: loanId });

        loan.status = 'Rejected';
        await loan.save();

        res.json({ status: 'success', message: 'Loan rejected successfully', data: loan });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}



exports.getRepaymentHistory = async (req, res) => {

    try {
        const { loanId } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'loanId is required' });
        }

        const loan = await Loan.findById(loanId);

        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        const repayments = await Repayment.find({ loan: loanId })
            .sort({ paymentDate: 1 })
            .populate('collectedBy', 'fname lname')
            .exec();


        if (!repayments) {
            return res.status(404).json({ status: 'error', message: 'Repayments not found' });
        }

        if (repayments.length === 0) {
            return res.status(400).json({ status: 'success', message: 'No repayments found' });
        }

        res.status(200).json({ status: 'success', data: repayments });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}

exports.getCountofLoans = async (req, res) => {
    try {
        const { status } = req.query;

        if (status) {
            const count = await Loan.countDocuments({ status });
            res.json({ status: 'success', count });
            return;
        }
        const count = await Loan.countDocuments({ status: { $in: ['Active'] } });
        res.json({ status: 'success', count });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getTotalMarketDetails = async (req, res) => {
    try {
        const activeOrApprovedFilter = { status: { $in: ['Active', 'Approved'] } };

        let totalMarketAmount = await Loan.aggregate([
            { $match: activeOrApprovedFilter },
            { $group: { _id: null, totalMarketAmount: { $sum: '$loanAmount' } } }
        ]);

        // Get the total amount repaid for Active or Approved loans
        let totalMarketAmountRepaid = await Loan.aggregate([
            { $match: activeOrApprovedFilter },
            { $group: { _id: null, totalMarketAmountRepaid: { $sum: '$totalPaid' } } }
        ]);

        // Handle if there are no loans
        if (totalMarketAmount.length === 0) {
            totalMarketAmount = [{ totalMarketAmount: 0 }];
        }
        if (totalMarketAmountRepaid.length === 0) {
            totalMarketAmountRepaid = [{ totalMarketAmountRepaid: 0 }];
        }

        res.json({
            status: 'success',
            data: {
                totalMarketAmount: totalMarketAmount[0].totalMarketAmount,
                totalMarketAmountRepaid: totalMarketAmountRepaid[0].totalMarketAmountRepaid
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getRepaymentHistoryToApprove = async (req, res) => {
    try {
        const { loanId, defaultDate, date, status, page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        console.log('getRepaymentHistoryToApprove req.query:', req.query);

        let query = {};

        if (loanId) {
            query.loan = loanId;
        }


        if (defaultDate == false && !date) {
            return res.status(400).json({ status: 'error', message: 'date is required if defaultDate is false' });
        }

        if (defaultDate == false && date) {
            if (date) {
                const startOfDay = new Date(date);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(date);
                endOfDay.setHours(23, 59, 59, 999);
                query.paymentDate = { $gte: startOfDay, $lte: endOfDay };

                console.log('query.paymentDate:', query.paymentDate);
            } else {
                // If no date provided, default to today
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                query.paymentDate = { $gte: today, $lt: tomorrow };
            }
        }
        if (status) {
            query.status = status;
        } else {
            query.status = 'Pending';
        }
        const repayments = await Repayment.find(query)
            .sort({ paymentDate: 1 })
            .populate('collectedBy', 'fname lname')
            .populate({
                path: 'loan',
                select: 'loanAmount customer loanStartDate loanEndDate outstandingAmount',
                populate: {
                    path: 'customer',
                    select: 'fname lname'
                }
            })
            .skip(skip)
            .limit(parseInt(limit))
            .exec();

        const total = await Repayment.countDocuments(query);

        if (repayments.length === 0) {
            return res.status(200).json({ status: 'success', message: 'No repayments found', data: [] });
        }

        const formattedRepayments = repayments.map(repayment => ({
            ...repayment.toObject(),
            collectedBy: repayment.collectedBy ? `${repayment.collectedBy.fname} ${repayment.collectedBy.lname}` : 'N/A',
            loanDetails: repayment.loan ? {
                loanAmount: repayment.loan.loanAmount,
                borrower: `${repayment.loan.customer.fname} ${repayment.loan.customer.lname}`,
                loanStartDate: repayment.loan.loanStartDate,
                loanEndDate: repayment.loan.loanEndDate,
                outstandingAmount: repayment.loan.outstandingAmount
            } : null
        }));

        res.status(200).json({
            status: 'success',
            data: formattedRepayments,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}

exports.approveRepaymentHistory = async (req, res) => {
    try {
        const { repaymentId } = req.body;

        console.log('Approve repayment history request body:', req.body);

        if (!repaymentId) {
            console.log('Repayment ID is not provided');
            return res.status(400).json({ status: 'error', message: 'Repayment ID is required' });
        }

        const repayment = await Repayment.findById(repaymentId);

        console.log('Found repayment:', repayment);

        if (!repayment) {
            console.log('Repayment not found');
            return res.status(404).json({ status: 'error', message: 'Repayment not found' });
        }

        repayment.status = 'Approved';

        await repayment.save();

        console.log('Repayment updated successfully:', repayment);

        res.status(200).json({ status: 'success', message: 'Repayment approved successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}



exports.assignLoanToEmployee = async (req, res) => {
    try {
        const { loanId, employeeId } = req.body;
        if (!loanId || !employeeId) {
            return res.status(400).json({ status: 'error', message: 'loanId and employeeId are required' });
        }

        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        if (loan.status !== 'Active') {
            return res.status(400).json({ status: 'error', message: 'Loan is not active' });
        }

        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ status: 'error', message: 'Employee not found' });
        }

        loan.assignedTo = employeeId;
        await loan.save();

        res.json({ status: 'success', message: 'Loan assigned to employee successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

// Improved applyPenaltyToALoanInstallment function
exports.applyPenaltyToALoanInstallment = async (req, res) => {
    try {
        console.log('Request body:', req.body);
        const { loanId, penaltyAmount, repaymentScheduleId } = req.body;

        if (!loanId || !repaymentScheduleId || !penaltyAmount) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        const loan = await Loan.findById(loanId);

        if (!loan) {
            console.log('Loan not found');
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        if (loan.status === 'Closed') {
            console.log('Loan already closed');
            return res.status(400).json({ status: 'error', message: 'Loan already closed' });
        }

        const repaymentSchedule = await RepaymentSchedule.findById(repaymentScheduleId);
        if (!repaymentSchedule || repaymentSchedule.loan.toString() !== loanId) {
            console.log('Repayment schedule not found or does not belong to the specified loan');
            return res.status(404).json({ status: 'error', message: 'Repayment schedule not found or does not belong to the specified loan' });
        }

        if (repaymentSchedule.penaltyApplied) {
            console.log('Penalty already applied');
            return res.status(400).json({ status: 'error', message: 'Penalty already applied' });
        }

        const penalty = new Penalty({
            loan: loanId,
            repaymentSchedule: repaymentScheduleId,
            amount: penaltyAmount,
            reason: 'Late payment',
        });

        console.log('Saving penalty: ', penalty);
        await penalty.save();

        repaymentSchedule.penaltyApplied = true;
        repaymentSchedule.penalty = penalty._id;
        repaymentSchedule.status = 'Overdue';

        repaymentSchedule.penaltyAmount = penaltyAmount;
        console.log('Saving repayment schedule: ', repaymentSchedule);
        await repaymentSchedule.save();

        //No need to modify the loan since we are modifying it in penalty model pre save
        res.status(200).json({ status: 'success', message: 'Penalty applied successfully', data: penalty });
    } catch (error) {
        console.error('Penalty application error:', error);
        res.status(500).json({ status: 'error', message: 'Error in applying penalty' });
    }
};


exports.removePenaltyFromALoanInstallment = async (req, res) => {
    try {
        console.log('Request body:', req.body);
        const { loanId, repaymentScheduleId } = req.body;

        if (!loanId || !repaymentScheduleId) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        const loan = await Loan.findById(loanId);
        console.log('Loan before modification:', JSON.stringify(loan, null, 2));
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        const repaymentSchedule = await RepaymentSchedule.findById(repaymentScheduleId);
        console.log('Repayment schedule before modification:', JSON.stringify(repaymentSchedule, null, 2));
        if (!repaymentSchedule || repaymentSchedule.loan.toString() !== loanId) {
            return res.status(404).json({ status: 'error', message: 'Repayment schedule not found or does not belong to the specified loan' });
        }

        if (!repaymentSchedule.penaltyApplied) {
            return res.status(400).json({ status: 'error', message: 'Penalty not applied' });
        }

        //const penaltyAmount = repaymentSchedule.penaltyAmount || 0;
        const penaltyId = repaymentSchedule.penalty;

        const peneltyDoc = await Penalty.findById(penaltyId);
        if (!peneltyDoc) {
            return res.status(404).json({ status: 'error', message: 'Penalty not found' });
        }

        const penaltyAmount = peneltyDoc.amount;


        // Remove the penalty document if it exists
        if (penaltyId) {
            const penalty = await Penalty.deleteOne(penaltyId);
            console.log('Penalty removed:', JSON.stringify(penalty, null, 2));
        }

        // Calculate total repayment for this schedule
        const totalRepayment = await Repayment.aggregate([
            { $match: { repaymentSchedule: repaymentSchedule._id } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const totalRepaidAmount = totalRepayment.length > 0 ? totalRepayment[0].total : 0;
        console.log('Total repaid amount:', totalRepaidAmount);

        // Update repayment schedule
        repaymentSchedule.penaltyApplied = false;
        repaymentSchedule.penalty = null;
        repaymentSchedule.penaltyAmount = 0;

        // Determine the status based on repayment
        if (totalRepaidAmount >= repaymentSchedule.originalAmount) {
            repaymentSchedule.status = 'Paid';
        } else if (totalRepaidAmount > 0) {
            repaymentSchedule.status = 'Partially Paid';
        } else if (new Date(repaymentSchedule.dueDate) < new Date()) {
            repaymentSchedule.status = 'Overdue';
        } else {
            repaymentSchedule.status = 'Pending';
        }

        console.log('Repayment schedule before saving:', JSON.stringify(repaymentSchedule, null, 2));
        await repaymentSchedule.save();
        console.log('Repayment schedule after saving:', JSON.stringify(repaymentSchedule, null, 2));

        // Update the loan document
        const previousTotalPenaltyAmount = loan.totalPenaltyAmount;
        const previousOutstandingAmount = loan.outstandingAmount;


        loan.totalPenaltyAmount = Math.max(0, loan.totalPenaltyAmount - penaltyAmount);
        loan.totalPenalty = loan.totalPenalty.filter(p => p && p.toString() !== penaltyId.toString());
        loan.outstandingAmount = Math.max(0, loan.outstandingAmount - penaltyAmount);

        console.log('Loan before saving:', {
            previousTotalPenaltyAmount,
            newTotalPenaltyAmount: loan.totalPenaltyAmount,
            previousOutstandingAmount,
            newOutstandingAmount: loan.outstandingAmount,
            totalPenalty: loan.totalPenalty
        });
        /* 
                const updatedLoan = await Loan.findByIdAndUpdate(
                    loanId,
                    {
                        $set: {
                            totalPenaltyAmount: loan.totalPenaltyAmount,
                            outstandingAmount: loan.outstandingAmount,
                            totalPenalty: loan.totalPenalty
                        }
                    },
                    { new: true, runValidators: true }
                );
        
                console.log('Loan after update:', JSON.stringify(updatedLoan, null, 2));
        
                if (!updatedLoan) {
                    throw new Error('Failed to update loan document');
                } */

        //No need to modify the loan as we are already doing in penalty model pre-save

        res.status(200).json({
            status: 'success',
            message: 'Penalty removed successfully',
            removedPenaltyId: penaltyId,
            removedPenaltyAmount: penaltyAmount,
            /*             updatedLoan: {
                            totalPenaltyAmount: updatedLoan.totalPenaltyAmount,
                            totalPenalty: updatedLoan.totalPenalty,
                            outstandingAmount: updatedLoan.outstandingAmount
                        }, */
            updatedRepaymentSchedule: {
                status: repaymentSchedule.status,
                penaltyApplied: repaymentSchedule.penaltyApplied,
                penaltyAmount: repaymentSchedule.penaltyAmount
            }
        });
    } catch (error) {
        console.error('Penalty removal error:', error);
        res.status(500).json({ status: 'error', message: 'Error in removing penalty' });
    }
};

exports.closeLoan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { loanId, totalRemainingAmountCustomerIsPaying, deleteLoanDocuments } = req.body;

        // Search the loan with Id
        const loan = await Loan.findById(loanId).session(session);
        if (!loan) {
            throw new Error('Loan not found');
        }

        // Check if totalRemainingAmountCustomerIsPaying is greater than outstandingAmount
        if (totalRemainingAmountCustomerIsPaying > loan.outstandingAmount) {
            throw new Error('Payment amount exceeds outstanding amount');
        }

        const originalPaymentAmount = totalRemainingAmountCustomerIsPaying;
        let remainingAmount = totalRemainingAmountCustomerIsPaying;

        // Handle RepaymentSchedules
        const repaymentSchedules = await RepaymentSchedule.find({ loan: loanId }).sort('dueDate').session(session);
        for (const schedule of repaymentSchedules) {
            if (['Paid', 'AdvancePaid', 'OverduePaid'].includes(schedule.status)) {
                continue;
            }

            const amountDue = schedule.status === 'PartiallyPaid'
                ? schedule.originalAmount - schedule.amount
                : schedule.amount;

            if (remainingAmount >= amountDue) {
                schedule.status = 'Paid';
                schedule.amount = schedule.originalAmount || schedule.amount;
                remainingAmount -= amountDue;
            } else if (remainingAmount > 0) {
                schedule.status = 'PartiallyPaid';
                schedule.originalAmount = schedule.originalAmount || schedule.amount;
                schedule.amount += remainingAmount;
                remainingAmount = 0;
            } else {
                schedule.status = 'Waived';
            }
            await schedule.save({ session });
        }

        // Handle penalties
        const pendingPenalties = await Penalty.find({ loan: loanId, status: 'Pending' }).session(session);
        for (const penalty of pendingPenalties) {
            if (remainingAmount >= penalty.amount) {
                penalty.status = 'Paid';
                remainingAmount -= penalty.amount;
            } else {
                penalty.status = 'Waived';
            }
            await penalty.save({ session });
        }

        // Update loan status and payments
        loan.status = 'Closed';
        loan.totalPaid += originalPaymentAmount;
        loan.outstandingAmount -= originalPaymentAmount;
        loan.loanClosedDate = new Date();

        // Create a repayment for the amount paid
        const repayment = new Repayment({
            repaymentSchedule: repaymentSchedules.map(schedule => schedule._id),
            amount: originalPaymentAmount,
            paymentDate: new Date(),
            paymentMethod: 'Other', // You might want to add this as a parameter in req.body
            status: 'Approved',
            loan: loan._id,
            balanceAfterPayment: loan.outstandingAmount,
        });

        // Validate the repayment before saving
        const validationError = repayment.validateSync();
        if (validationError) {
            throw new Error(`Repayment validation failed: ${validationError.message}`);
        }

        await repayment.save({ session });

        // Handle document deletion if required
        if (deleteLoanDocuments) {
            await deleteDocuments(loanId);
        }

        await loan.save({ session });

        // Update customer's activeLoans
        await Customer.findByIdAndUpdate(
            loan.customer,
            { $pull: { activeLoans: loan._id } },
            { session }
        );

        await session.commitTransaction();
        res.status(200).json({ status: 'success', message: 'Loan closed successfully' });
    } catch (error) {
        console.error('Loan closure error:', error);
        await session.abortTransaction();
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        session.endSession();
    }
};