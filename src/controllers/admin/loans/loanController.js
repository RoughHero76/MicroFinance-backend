const mongoose = require('mongoose');
const Loan = require('../../../models/Customers/Loans/LoanModel');
const Repayment = require('../../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Document = require('../../../models/Customers/Loans/DocumentsModel');
const Employee = require('../../../models/Employee/EmployeeModel');
const Penalty = require('../../../models/Customers/Loans/Repayment/PenaltyModel');
const Customer = require('../../../models/Customers/profile/CustomerModel');
const { generateRepaymentSchedule } = require('../../../helpers/loan');
const { getSignedUrl, extractFilePath, uploadFile, deleteDocuments, deleteDocumentsUrls } = require('../../../config/firebaseStorage');
const { updateLoanStatuses } = require('../../../crone/LoanStatusCron');
const multer = require('multer');
const LoanStatus = require('../../../models/Customers/Loans/loanStatusModel');
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

            // Validation checks 

            if (!customerUid || !loanAmount || !principalAmount || !loanDuration || !installmentFrequency || !interestRate || !loanStartDate) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'Missing required loan parameters' });
            }

            if (!parsedDocuments || parsedDocuments.length === 0) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'Missing required documents' });
            }

            const customer = await Customer.findOne({ uid: customerUid }).session(session);

            if (!customer) {
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


//Delete Document or Update Document (Upload a new one to exisitng loan)

exports.addDocumentsToLoan = [
    upload.array('documents'),
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { loanId } = req.params;
            const { documentNames, documentTypes } = req.body;

            if (!loanId) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'Missing required loan id' });
            }

            if (!req.files || req.files.length === 0) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'No documents provided' });
            }

            if (!documentNames || !documentTypes || documentNames.length !== documentTypes.length) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'Invalid document information provided' });
            }

            const loan = await Loan.findById(loanId).session(session);

            if (!loan) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ status: 'error', message: 'Loan not found' });
            }

            const customer = await Customer.findById(loan.customer).session(session);

            if (!customer) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ status: 'error', message: 'Customer not found' });
            }

            const customerUid = customer.uid;

            const uploadFileWithPath = async (file, documentName) => {
                const path = `${customerUid}/${loan._id}/${documentName}`;
                return await uploadFile(file, path);
            };

            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const documentUrl = await uploadFileWithPath(file, documentNames[i]);
                const newDocument = new Document({
                    loan: loan._id,
                    documentName: documentNames[i],
                    documentUrl: documentUrl,
                    documentType: documentTypes[i]
                });
                await newDocument.save({ session });
                loan.documents.push(newDocument._id);
            }

            await loan.save({ session });

            await session.commitTransaction();
            session.endSession();

            res.status(200).json({ status: 'success', message: 'Documents added successfully', loan });
        } catch (error) {
            console.error(error);
            await session.abortTransaction();
            session.endSession();
            res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
        }
    }
];
exports.deleteDocumentsFromLoan = async (req, res) => {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { loanId } = req.params;
            const { documentIds } = req.body;

            if (!documentIds || documentIds.length === 0) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'No document IDs provided' });
            }

            const loan = await Loan.findById(loanId).session(session);

            if (!loan) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ status: 'error', message: 'Loan not found' });
            }

            const documentsToDelete = await Document.find({
                _id: { $in: documentIds },
                loan: loanId
            }).session(session);

            if (documentsToDelete.length !== documentIds.length) {
                console.log(`Documents to delete: ${documentsToDelete}` + `Document IDs: ${documentIds}`);
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: 'error', message: 'One or more document IDs are invalid or do not belong to this loan' });
            }

            const documentUrls = documentsToDelete.map(doc => doc.documentUrl);

            // Delete documents from storage
            await deleteDocumentsUrls(documentUrls);

            // Remove document references from the loan
            loan.documents = loan.documents.filter(docId => !documentIds.includes(docId.toString()));
            await loan.save({ session });

            // Delete document records from the database
            await Document.deleteMany({ _id: { $in: documentIds } }).session(session);

            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({ status: 'success', message: 'Documents deleted successfully', loan });
        } catch (error) {
            console.error(error);
            await session.abortTransaction();
            session.endSession();

            if (error.errorLabels && error.errorLabels.includes('TransientTransactionError') && retries < maxRetries - 1) {
                console.log(`Retrying transaction (attempt ${retries + 2} of ${maxRetries})...`);
                retries++;
                continue;
            }

            return res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
        }
    }
};

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

        // Delete loan status
        await LoanStatus.findByIdAndDelete({ loan: loanId }, { session });

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
            includeAssignedTo,
            includePenalty,
            includeDocuments,
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
        if (includeDocuments === 'true') {
            populateOptions.push({
                path: 'documents',
                select: 'uid documentName documentUrl documentType status'
            });
        }

        // Include Details of assignedTo
        if (includeAssignedTo === 'true') {
            populateOptions.push({
                path: 'assignedTo',
                select: 'uid fname lname'
            });
        }

        // Include Penaltys
        if (includePenalty === 'true') {
            populateOptions.push({
                path: 'totalPenalty',
                select: 'amount reason appliedDate'
            });
        }

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
        const { loanNumber, defaultDate, date, status, page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        console.log('getRepaymentHistoryToApprove req.query:', req.query);

        let query = {};

        if (loanNumber) {
            query.loan = loanNumber;
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

/* Rejecting repayments */
exports.rejectRepaymentHistory = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { repaymentId } = req.body;

        if (!repaymentId) {
            throw new Error('Repayment ID is required');
        }

        console.log('Reject repayment history request body:', req.body);

        // Find the repayment
        const repayment = await Repayment.findById(repaymentId).session(session);
        if (!repayment) {
            throw new Error('Repayment not found');
        }

        console.log('Found repayment:', repayment);

        if (repayment.status !== 'Pending') {
            throw new Error('Only pending repayments can be rejected');
        }

        // Check if logicNote is valid
        if (repayment.logicNote && repayment.logicNote.trim() !== '') {
            // Existing logic for processing logicNote
            const logicNoteDetails = repayment.logicNote.split(' | ');
            console.log('Logic notes:', logicNoteDetails);

            for (const detail of logicNoteDetails) {
                const match = detail.match(/Schedule (\w+):\s*(.*)/);
                if (!match) {
                    console.warn(`Skipping invalid logic note detail: ${detail}`);
                    continue;
                }
                const [, scheduleId, action] = match;
                await processSchedule(scheduleId, action, session, repayment);
            }
        } else {
            // New logic for handling missing or invalid logicNote
            console.log('LogicNote is missing or invalid. Using fallback logic.');
            const affectedSchedules = await RepaymentSchedule.find({ repayments: repaymentId }).session(session);

            for (const schedule of affectedSchedules) {
                await processFallbackSchedule(schedule, repayment, session);
            }
        }

        // Update loan
        const loan = await Loan.findById(repayment.loan).session(session);
        console.log('Found loan:', loan);
        loan.totalPaid -= repayment.amount;
        loan.outstandingAmount += repayment.amount;
        await loan.save({ session });

        console.log('Updated loan:', loan);

        // Update employee
        if (repayment.collectedBy) {
            const employee = await Employee.findById(repayment.collectedBy).session(session);
            console.log('Found employee:', employee);
            employee.collectedRepayments = employee.collectedRepayments.filter(id => !id.equals(repayment._id));
            await employee.save({ session });

            console.log('Updated employee:', employee);
        }

        // Update repayment status
        repayment.status = 'Rejected';
        await repayment.save({ session });

        console.log('Updated repayment:', repayment);

        await session.commitTransaction();

        res.status(200).json({
            status: 'success',
            message: 'Repayment rejected successfully',
            data: {
                repaymentId: repayment._id,
                loanId: loan._id,
                amountReverted: repayment.amount
            }
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('Repayment rejection error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    } finally {
        session.endSession();
    }
};

async function processSchedule(scheduleId, action, session, repayment) {
    const schedule = await RepaymentSchedule.findById(scheduleId).session(session);
    if (!schedule) {
        console.warn(`Schedule ${scheduleId} not found, skipping`);
        return;
    }

    console.log('Found schedule:', schedule);

    // Remove this repayment from the schedule's repayments array
    schedule.repayments = schedule.repayments.filter(id => !id.equals(repayment._id));

    // Revert the schedule status based on the action
    if (action.includes('Full payment')) {
        schedule.status = 'Pending';
        schedule.amount = schedule.originalAmount || schedule.amount;
    } else if (action.includes('Partial payment')) {
        if (schedule.status === 'PartiallyPaid') {
            const amountMatch = action.match(/(\d+(\.\d+)?)/);
            if (amountMatch) {
                schedule.amount -= parseFloat(amountMatch[1]);
            }
        } else {
            schedule.status = 'Pending';
            schedule.amount = (schedule.originalAmount || schedule.amount) / 2;
        }
    } else if (action.includes('Overdue paid')) {
        schedule.status = 'Overdue';
    } else if (action.includes('Partially paid amount now fully paid')) {
        schedule.status = 'PartiallyPaid';
        schedule.amount = (schedule.originalAmount || schedule.amount) / 2;
    } else if (action.includes('Advance paid')) {
        schedule.status = 'Pending';
    }

    console.log(`Reverted schedule ${scheduleId} status to ${schedule.status}`);

    schedule.paymentDate = null;
    schedule.collectedBy = null;

    await schedule.save({ session });
}

async function processFallbackSchedule(schedule, repayment, session) {
    console.log('Processing fallback for schedule:', schedule._id);

    // Remove this repayment from the schedule's repayments array
    schedule.repayments = schedule.repayments.filter(id => !id.equals(repayment._id));

    if (schedule.penaltyApplied) {
        if (schedule.status === 'PartiallyPaidFullyPaid') {
            schedule.status = 'PartiallyPaid';
            schedule.amount = (schedule.originalAmount || schedule.amount) / 2;
        } else {
            schedule.status = 'Overdue';
        }
    } else {
        schedule.status = 'Pending';
    }

    console.log(`Fallback: Set schedule ${schedule._id} status to ${schedule.status}`);

    schedule.paymentDate = null;
    schedule.collectedBy = null;

    await schedule.save({ session });
}
/* Rejecting repayments ends*/

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

        // Check if totalRemainingAmountCustomerIsPaying is greater than outstandingAmount + totalPenaltyAmount
        const totalDue = loan.outstandingAmount + loan.totalPenaltyAmount;
        if (totalRemainingAmountCustomerIsPaying > totalDue) {
            throw new Error('Payment amount exceeds total due amount');
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
                loan.totalPenaltyAmount -= penalty.amount; // Reduce totalPenaltyAmount as penalty is paid
            } else {
                penalty.status = 'Waived';
            }
            await penalty.save({ session });
        }

        // Update loan status and payments
        loan.status = 'Closed';
        loan.totalPaid += originalPaymentAmount;

        // Adjust outstandingAmount and totalPenaltyAmount
        const paidTowardsPrincipal = Math.min(loan.outstandingAmount, originalPaymentAmount);
        loan.outstandingAmount -= paidTowardsPrincipal;
        const paidTowardsPenalties = originalPaymentAmount - paidTowardsPrincipal;
        loan.totalPenaltyAmount = Math.max(0, loan.totalPenaltyAmount - paidTowardsPenalties);

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