const mongoose = require('mongoose');
const Loan = require('../../models/Customers/Loans/LoanModel');
const Repayment = require('../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Penalty = require('../../models/Customers/Loans/Repayment/PenaltyModel');
const Customer = require('../../models/Customers/profile/CustomerModel');
const { generateRepaymentSchedule } = require('../../helpers/loan');
const { getSignedUrl } = require('../../config/firebaseStorage');
const { uploadFile } = require('../../config/firebaseStorage');
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

            const customer = await Customer.findOne({ uid: customerUid });
            console.log('Customer found:', customer);

            if (!customer) {
                console.log('Customer not found with UID:', customerUid);
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

            // Save the loan to get an _id
            await newLoan.save();

            let loanId = newLoan._id.toString();


            // Function to upload file with the new path structure
            const uploadFileWithPath = async (file, documentType) => {
                const path = `${customerUid}/${loanId}/${documentType}`;
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
                await repaymentSchedule.save();
                return repaymentSchedule._id;
            }));

            // Update the loan document
            newLoan.documents = documentLinks;
            newLoan.repaymentSchedules = repaymentSchedules;

            await newLoan.save();
            customer.loans.push(newLoan._id);
            await customer.save();

            res.status(201).json({ status: 'success', loan: newLoan });
        } catch (error) {
            console.error(error);
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

        // Delete Repayment Schedule
        await RepaymentSchedule.deleteMany({ loan: loanId });

        // Delete Repayments 
        await Repayment.deleteMany({ loan: loanId });

        // Delete Penalties
        await Penalty.deleteMany({ loan: loanId });

        await Loan.findByIdAndDelete(loanId);

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


    /**
     * Extracts the file path from a URL. The URL is expected to be in the format of
     * a Google Cloud Storage URL, e.g.:
     * https://storage.cloud.google.com/bucket-name/path/to/file.txt
     * Returns the file path as a string, e.g. "path/to/file.txt"
     * @param {string} url - The URL to extract the file path from
     * @returns {string} The file path
     */
    function extractFilePath(url) {
        const parsedUrl = new URL(url);
        const pathParts = parsedUrl.pathname.split('/');
        // Remove the first two segments (which are likely the repeated bucket name)
        return pathParts.slice(2).join('/');
    }


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

        // Build the query for RepaymentSchedule
        let query = { loan: loanId };

        // Apply status filter
        if (statusFilter) {
            query.status = statusFilter;
        }

        // Apply date range filter
        if (dateFrom || dateTo) {
            query.dueDate = {};
            if (dateFrom) query.dueDate.$gte = new Date(dateFrom);
            if (dateTo) query.dueDate.$lte = new Date(dateTo);
        }

        // Apply search term
        if (searchTerm) {
            const searchRegex = new RegExp(searchTerm, 'i');
            query.$or = [
                { amount: { $regex: searchRegex } },
                { status: { $regex: searchRegex } },
                { dueDate: { $regex: searchRegex } }
            ];
        }

        // Count total documents for pagination
        const total = await RepaymentSchedule.countDocuments(query);

        // Fetch paginated repayment schedule
        const repaymentSchedule = await RepaymentSchedule.find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ dueDate: 1 });

        // Send paginated response
        res.json({
            status: 'success',
            data: {
                repaymentSchedule,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
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
        const { status } = req.query;

        if (status) {
            const count = await Loan.countDocuments({ status });
            res.json({ status: 'success', count });
            return;
        }
        const count = await Loan.countDocuments();
        res.json({ status: 'success', count });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.getTotalMarketDetails = async (req, res) => {
    try {
        let totalMarketAmmount = await Loan.aggregate([
            { $group: { _id: null, totalMarketAmmount: { $sum: '$loanAmount' } } }
        ]);

        // Get the total ammount repaid

        const totalMarketAmmountRepaid = await Loan.aggregate([
            { $group: { _id: null, totalMarketAmmountRepaid: { $sum: '$totalPaid' } } }
        ]);

        //Handle if there no loans so thus there wont be market ammout and etc

        if (totalMarketAmmount.length === 0) {
            totalMarketAmmount[0] = { totalMarketAmmount: 0 };
        }
        if (totalMarketAmmountRepaid.length === 0) {
            totalMarketAmmountRepaid[0] = { totalMarketAmmountRepaid: 0 };
        }


        res.json({ status: 'success', data: { totalMarketAmmount: totalMarketAmmount[0].totalMarketAmmount, totalMarketAmmountRepaid: totalMarketAmmountRepaid[0].totalMarketAmmountRepaid } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

