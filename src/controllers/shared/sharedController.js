const Customer = require("../../models/Customers/profile/CustomerModel");
const Loan = require("../../models/Customers/Loans/LoanModel");
const RepaymentSchedule = require("../../models/Customers/Loans/Repayment/RepaymentScheduleModel");
const Repayment = require("../../models/Customers/Loans/Repayment/Repayments");
const Penalty = require("../../models/Customers/Loans/Repayment/PenaltyModel");
const Admin = require("../../models/Admin/AdminModel");
const Employee = require("../../models/Employee/EmployeeModel");
const { getSignedUrl, extractFilePath, uploadFile } = require('../../config/firebaseStorage');
const { generateRepaymentSchedule } = require('../../helpers/loan')
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

exports.search = async (req, res) => {
    const { query, page = 1, limit = 10 } = req.body;
    const skip = (page - 1) * limit;

    try {
        let searchQuery = {};

        // If there is a general query (for name, email, etc.)
        if (query) {
            searchQuery.$or = [
                { fname: { $regex: query, $options: 'i' } },
                { lname: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { phoneNumber: { $regex: query, $options: 'i' } },
                { userName: { $regex: query, $options: 'i' } },
            ];
        }

        let customerIdsFromLoanSearch = [];

        // If the query is intended to search loan numbers
        if (query) {
            const loans = await Loan.find({ loanNumber: { $regex: query, $options: 'i' } });
            customerIdsFromLoanSearch = loans.map(loan => loan.customer.toString());
        }

        if (customerIdsFromLoanSearch.length > 0) {
            searchQuery.$or = searchQuery.$or || [];
            searchQuery.$or.push({ _id: { $in: customerIdsFromLoanSearch } });
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

exports.addProfilePictureAdminAndEmployee = [
    upload.single('profilePic'),
    async (req, res) => {
        try {
            const role = req.role;
            const file = req.file;
            const userUid = req.uid;

            console.log(`Role :${role}, UID: ${userUid}`);


            if (!file) {
                return res.status(400).json({
                    status: "error",
                    message: "Please upload a file"
                });
            }

            if (role === "admin") {
                const admin = await Admin.findOne({ uid: userUid });
                if (!admin) {
                    return res.status(404).json({
                        status: "error",
                        message: "Admin not found"
                    });
                }

                if (admin.profilePic) {
                    const oldFilePath = extractFilePath(admin.profilePic);
                    try {
                        await bucket.file(oldFilePath).delete();
                    } catch (error) {
                        console.error(`Error deleting file from Firebase Storage: ${error.message}`);
                    }
                }

                const destination = `admin/profile/${userUid}`;
                try {
                    const publicUrl = await uploadFile(file, destination);

                    admin.profilePic = publicUrl;
                    await admin.save();
                } catch (error) {
                    console.error(`Error uploading file to Firebase Storage: ${error.message}`);
                    return res.status(500).json({
                        status: "error",
                        message: "Error uploading file to Firebase Storage"
                    });
                }

                return res.status(200).json({
                    status: "success",
                    message: "Profile picture added successfully"
                });

            } else if (role === "employee") {
                const employee = await Employee.findOne({ uid: userUid });
                if (!employee) {
                    return res.status(404).json({
                        status: "error",
                        message: "Employee not found"
                    });
                }

                if (employee.profilePic) {
                    const oldFilePath = extractFilePath(employee.profilePic);
                    try {
                        await bucket.file(oldFilePath).delete();
                    } catch (error) {
                        console.error(`Error deleting file from Firebase Storage: ${error.message}`);
                    }
                }

                const destination = `employee/profile/${userUid}`;
                try {
                    const publicUrl = await uploadFile(file, destination);

                    employee.profilePic = publicUrl;
                    await employee.save();
                } catch (error) {
                    console.error(`Error uploading file to Firebase Storage: ${error.message}`);
                    return res.status(500).json({
                        status: "error",
                        message: "Error uploading file to Firebase Storage"
                    });
                }

                return res.status(200).json({
                    status: "success",
                    message: "Profile picture added successfully"
                });

            } else {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid role"
                });

            }


        }
        catch (error) {
            console.error('Profile picture add error:', error);
            res.status(500).json({
                status: "error",
                message: "An error occurred while adding the profile picture.",
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

]

