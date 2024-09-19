const mongoose = require('mongoose');
const { getStorage } = require('firebase-admin/storage');
const Loan = require('../../models/Customers/Loans/LoanModel');
const Repayment = require('../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Employee = require('../../models/Employee/EmployeeModel');
const Penalty = require('../../models/Customers/Loans/Repayment/PenaltyModel');
const Customer = require('../../models/Customers/profile/CustomerModel');
const { generateRepaymentSchedule } = require('../../helpers/loan');
const { getSignedUrl, extractFilePath, uploadFile } = require('../../config/firebaseStorage');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });


exports.createLoan = [
    upload.fields([
        { name: 'stampPaperPhoto', maxCount: 1 },
        { name: 'promissoryNotePhoto', maxCount: 1 },
        { name: 'blankPaper', maxCount: 1 },
        { name: 'cheques', maxCount: 10 },
        { name: 'governmentIdsFront', maxCount: 5 },
        { name: 'governmentIdsBack', maxCount: 5 },
    ]),
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
                chequesDetails,
                governmentIdsDetails,
                gracePeriod,
                documents
            } = req.body;

            const parsedDocuments = JSON.parse(documents);
            const { stampPaper, promissoryNote } = parsedDocuments;

            console.log('Parsed request body', {
                customerUid,
                loanAmount,
                principalAmount,
                loanDuration,
                installmentFrequency,
                interestRate,
                loanStartDate,
                chequesDetails,
                governmentIdsDetails,
                gracePeriod,
                stampPaper,
                promissoryNote
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

            // Create a new loan document with all required fields
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
                outstandingAmount: parsedBody.loanAmount
            });

            // Function to upload file with the new path structure
            const uploadFileWithPath = async (file, documentType) => {
                const path = `${customerUid}/${newLoan._id}/${documentType}`;
                return await uploadFile(file, path);
            };

            const documentLinks = {
                stampPaper,
                promissoryNote,
                stampPaperPhotoLink: await uploadFileWithPath(req.files['stampPaperPhoto'][0], 'stampPaperPhoto'),
                promissoryNotePhotoLink: await uploadFileWithPath(req.files['promissoryNotePhoto'][0], 'promissoryNotePhoto'),
                blankPaper: await uploadFileWithPath(req.files['blankPaper'][0], 'blankPaper'),
                cheques: await Promise.all(req.files['cheques'].map(async (file, index) => ({
                    photoLink: await uploadFileWithPath(file, `cheques/cheque_${index + 1}`),
                    ...JSON.parse(chequesDetails)[index]
                }))),
                governmentIds: await Promise.all(JSON.parse(governmentIdsDetails).map(async (id, index) => ({
                    ...id,
                    frontPhotoLink: await uploadFileWithPath(req.files['governmentIdsFront'][index], `governmentIds/${id.type}_front`),
                    backPhotoLink: await uploadFileWithPath(req.files['governmentIdsBack'][index], `governmentIds/${id.type}_back`)
                })))
            };

            console.log('Document links object created:', documentLinks);

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

            // Update the loan document
            newLoan.documents = documentLinks;
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
exports.createLoanWithOnlyDocumentsURL = async (req, res) => {
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
        const { loanId, force } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'loanId is required' });
        }

        const loan = await Loan.findById(loanId);

        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }


        const customer = await Customer.findById(loan.customer);

        if (!customer) {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
        }

        customer.loans = customer.loans.filter(l => l.toString() !== loanId);

        if (force == false) {
            if (loan.status === 'Active') {
                return res.status(400).json({ status: 'error', message: 'Loan is active. Cannot delete it.' });
            }
        }

        await Customer.findByIdAndUpdate(customer._id, { $set: { loans: customer.loans } });

        // Delete Repayment Schedule
        await RepaymentSchedule.deleteMany({ loan: loanId });

        // Delete Repayments 
        await Repayment.deleteMany({ loan: loanId });

        // Delete Penalties
        await Penalty.deleteMany({ loan: loanId });

        await Loan.findByIdAndDelete(loanId);

        //Delete Collected Collection History in Employee Collection

        res.json({ status: 'success', message: 'Loan deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
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

        // Filter by limited loan details
        if (limitedLoanDetails === 'true') {
            select = 'uid loanAmount status loanStartDate loanEndDate';
        } else {
            select = '';
        }

        let populateOptions = [];

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

        // Always include signed documents by default
        loans = await Promise.all(loans.map(async (loan) => {
            loan = loan.toObject();
            if (loan.documents) {
                // Generate signed URLs for document fields
                const singleDocFields = ['stampPaperPhotoLink', 'promissoryNotePhotoLink', 'blankPaper'];
                for (const field of singleDocFields) {
                    if (loan.documents[field]) {
                        const filePath = extractFilePath(loan.documents[field]);
                        try {
                            loan.documents[field] = await getSignedUrl(filePath);
                        } catch (error) {
                            console.error(`Error generating signed URL for ${field}:`, error);
                            loan.documents[field] = null;
                        }
                    }
                }

                // Generate signed URLs for cheques
                if (loan.documents.cheques) {
                    loan.documents.cheques = await Promise.all(loan.documents.cheques.map(async (cheque) => {
                        if (cheque.photoLink) {
                            const filePath = extractFilePath(cheque.photoLink);
                            try {
                                cheque.photoLink = await getSignedUrl(filePath);
                            } catch (error) {
                                console.error('Error generating signed URL for cheque:', error);
                                cheque.photoLink = null;
                            }
                        }
                        return cheque;
                    }));
                }

                // Generate signed URLs for government IDs
                if (loan.documents.governmentIds) {
                    loan.documents.governmentIds = await Promise.all(loan.documents.governmentIds.map(async (id) => {
                        if (id.frontPhotoLink) {
                            const frontFilePath = extractFilePath(id.frontPhotoLink);
                            try {
                                id.frontPhotoLink = await getSignedUrl(frontFilePath);
                            } catch (error) {
                                console.error('Error generating signed URL for government ID front:', error);
                                id.frontPhotoLink = null;
                            }
                        }
                        if (id.backPhotoLink) {
                            const backFilePath = extractFilePath(id.backPhotoLink);
                            try {
                                id.backPhotoLink = await getSignedUrl(backFilePath);
                            } catch (error) {
                                console.error('Error generating signed URL for government ID back:', error);
                                id.backPhotoLink = null;
                            }
                        }
                        return id;
                    }));
                }
            }
            return loan;
        }));

        // Get total count for pagination
        const totalLoans = await Loan.countDocuments(query);

        // Include repayment schedule
        if (includeRepaymentSchedule === 'true') {
            loans = await Promise.all(loans.map(async (loan) => {
                loan = loan.toObject();
                loan.repaymentSchedule = await RepaymentSchedule.find({ loan: loan._id })
                    .select('dueDate amount status penaltyApplied penalty')
                    .sort({ dueDate: 1 });
                return loan;
            }));
        }

        // Include repayment history
        if (includeRepaymentHistory === 'true') {
            loans = await Promise.all(loans.map(async (loan) => {
                loan = loan.toObject();
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

exports.getRepaymentSchedule = async (req, res) => {
    try {
        const { loanId, searchTerm, statusFilter, dateFrom, dateTo } = req.query;
        const { page = 1, limit = 10 } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'Loan ID is required' });
        }

        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ status: 'error', message: 'Loan not found' });
        }

        let query = { loan: loanId };

        if (statusFilter) query.status = statusFilter;

        if (dateFrom || dateTo) {
            query.dueDate = {};
            if (dateFrom) query.dueDate.$gte = new Date(dateFrom);
            if (dateTo) query.dueDate.$lte = new Date(dateTo);
        }

        if (searchTerm) {
            const searchRegex = new RegExp(searchTerm, 'i');
            query.$or = [
                { amount: { $regex: searchRegex } },
                { status: { $regex: searchRegex } },
                { dueDate: { $regex: searchRegex } }
            ];
        }

        const skip = (page - 1) * limit;
        const limitNum = parseInt(limit);

        const [total, repaymentSchedule] = await Promise.all([
            RepaymentSchedule.countDocuments(query),
            RepaymentSchedule.find(query)
                .skip(skip)
                .limit(limitNum)
                .sort({ dueDate: 1 })
                .lean()
        ]);

        if (repaymentSchedule.length > 0) {
            const repaymentIds = repaymentSchedule.map(r => r._id);
            const penalties = await Penalty.find({
                loan: loanId,
                repaymentSchedule: { $in: repaymentIds }
            }).lean();

            const penaltyMap = penalties.reduce((acc, penalty) => {
                acc[penalty.repaymentSchedule.toString()] = penalty;
                return acc;
            }, {});

            repaymentSchedule.forEach(repayment => {
                repayment.penalty = penaltyMap[repayment._id.toString()] || null;
            });
        }

        let loanStatus = loan.status;

        res.json({
            status: 'success',
            data: {
                repaymentSchedule,
                loanStatus,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limitNum),
                totalEntries: total
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

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
            return res.status(200).json({ status: 'success', message: 'No repayments found' });
        }

        res.status(200).json({ status: 'success', data: repayments });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}


/* exports.approveRepaymentHistory = async (req, res) => {
    try {
        const { repaymentScheduleId } = req.query;

        if (!repaymentScheduleId) {
            return res.status(400).json({ status: 'error', message: 'repaymentScheduleId is required' });
        }

        const repaymentSchedule = await RepaymentSchedule.findById(repaymentScheduleId);
        if (!repaymentSchedule) {
            return res.status(404).json({ status: 'error', message: 'Repayment schedule not found' });
        }

        if 
 */


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

        if (!repaymentId) {
            return res.status(400).json({ status: 'error', message: 'Repayment ID is required' });
        }

        const repayment = await Repayment.findById(repaymentId);

        if (!repayment) {
            return res.status(404).json({ status: 'error', message: 'Repayment not found' });
        }

        repayment.status = 'Approved';

        await repayment.save();

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

        loan.totalPenaltyAmmount += penaltyAmount;
        loan.totalPenalty.push(penalty._id);
        loan.outstandingAmount += penaltyAmount;
        console.log('Saving loan: ', loan);
        await loan.save();

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
            const penalty = await Penalty.findByIdAndDelete(penaltyId);
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
        const previousTotalPenaltyAmount = loan.totalPenaltyAmmount;
        const previousOutstandingAmount = loan.outstandingAmount;


        loan.totalPenaltyAmmount = Math.max(0, loan.totalPenaltyAmmount - penaltyAmount);
        loan.totalPenalty = loan.totalPenalty.filter(p => p && p.toString() !== penaltyId.toString());
        loan.outstandingAmount = Math.max(0, loan.outstandingAmount - penaltyAmount);

        console.log('Loan before saving:', {
            previousTotalPenaltyAmount,
            newTotalPenaltyAmount: loan.totalPenaltyAmmount,
            previousOutstandingAmount,
            newOutstandingAmount: loan.outstandingAmount,
            totalPenalty: loan.totalPenalty
        });

        const updatedLoan = await Loan.findByIdAndUpdate(
            loanId,
            {
                $set: {
                    totalPenaltyAmmount: loan.totalPenaltyAmmount,
                    outstandingAmount: loan.outstandingAmount,
                    totalPenalty: loan.totalPenalty
                }
            },
            { new: true, runValidators: true }
        );

        console.log('Loan after update:', JSON.stringify(updatedLoan, null, 2));

        if (!updatedLoan) {
            throw new Error('Failed to update loan document');
        }

        res.status(200).json({
            status: 'success',
            message: 'Penalty removed successfully',
            removedPenaltyId: penaltyId,
            removedPenaltyAmount: penaltyAmount,
            updatedLoan: {
                totalPenaltyAmmount: updatedLoan.totalPenaltyAmmount,
                totalPenalty: updatedLoan.totalPenalty,
                outstandingAmount: updatedLoan.outstandingAmount
            },
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
            const bucket = getStorage().bucket();
            const customer = await Customer.findById(loan.customer);
            const customerUid = customer.uid;

            // Function to delete file with correct path
            const deleteFileFromStorage = async (filePath) => {
                if (!filePath) return;
                try {
                    await bucket.file(filePath).delete();
                    console.log(`Successfully deleted file: ${filePath}`);
                } catch (error) {
                    console.error(`Failed to delete file: ${filePath}`, error);
                }
            };

            // Example usage in the deletion code
            await deleteFileFromStorage(`${customerUid}/${loan._id}/stampPaperPhoto`);
            await deleteFileFromStorage(`${customerUid}/${loan._id}/promissoryNotePhoto`);
            await deleteFileFromStorage(`${customerUid}/${loan._id}/blankPaper`);

            // For cheques
            for (let i = 0; i < loan.documents.cheques.length; i++) {
                await deleteFileFromStorage(`${customerUid}/${loan._id}/cheques/cheque_${i + 1}`);
            }

            // For government IDs
            for (const id of loan.documents.governmentIds) {
                await deleteFileFromStorage(`${customerUid}/${loan._id}/governmentIds/${id.type}_front`);
                await deleteFileFromStorage(`${customerUid}/${loan._id}/governmentIds/${id.type}_back`);
            }

            // Clear document fields in the loan
            loan.documents = {
                stampPaper: null,
                promissoryNote: null,
                stampPaperPhotoLink: null,
                promissoryNotePhotoLink: null,
                blankPaper: null,
                cheques: [],
                governmentIds: []
            };
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