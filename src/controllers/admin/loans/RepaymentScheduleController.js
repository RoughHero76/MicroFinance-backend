//src/controllers/admin/loans/RepaymentScheduleController.js
const Loan = require('../../../models/Customers/Loans/LoanModel');
const Repayment = require('../../../models/Customers/Loans/Repayment/Repayments');
const RepaymentSchedule = require('../../../models/Customers/Loans/Repayment/RepaymentScheduleModel');
const Penalty = require('../../../models/Customers/Loans/Repayment/PenaltyModel');

exports.getRepaymentSchedule = async (req, res) => {
    try {
        const { loanId, searchTerm, statusFilter, dateFrom, dateTo } = req.query;
        const { page = 1, limit = 10 } = req.query;

        if (!loanId) {
            return res.status(400).json({ status: 'error', message: 'Loan ID is required' });
        }

        const loan = await Loan.findById(loanId).select('status');
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
                .select('_id dueDate amount status penaltyApplied originalAmount loanInstallmentNumber')
                .skip(skip)
                .limit(limitNum)
                .sort({ dueDate: 1 })
                .populate({
                    path: 'repayments',
                    select: 'amount paymentDate paymentMethod transactionId status',
                    populate: {
                        path: 'collectedBy',
                        select: 'fname lname'
                    }
                })
                .lean()
        ]);

        if (repaymentSchedule.length > 0) {
            const repaymentIds = repaymentSchedule.map(r => r._id);
            const penalties = await Penalty.find({
                loan: loanId,
                repaymentSchedule: { $in: repaymentIds }
            }).select('repaymentSchedule amount reason appliedDate status').lean();

            const penaltyMap = penalties.reduce((acc, penalty) => {
                acc[penalty.repaymentSchedule.toString()] = penalty;
                return acc;
            }, {});

            repaymentSchedule.forEach(repayment => {
                repayment.penalty = penaltyMap[repayment._id.toString()] || null;
            });
        }

        res.json({
            status: 'success',
            data: {
                repaymentSchedule,
                loanStatus: loan.status,
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
/*


All of this good and all but what I don't understand
where are required fields we are getting for advance logic? 
for example, in advance logic we may require fields from user, 
where are those fields?  From the body we are only getting  
const { id, status, paymentDate, amount, advanceLogic } = req.body;  
if it required for other fields can you modify that we can get those fields
 
*/

exports.updateRepaymentSchedule = async (req, res) => {
    try {
        const {
            id,
            status,
            paymentDate,
            amount,
            advanceLogic,
            paymentMethod,
            penaltyAmount,
            penaltyReason,
            penaltyAppliedDate,
            transactionId,
            collectedBy
        } = req.body;

        if (!id) {
            return res.status(400).json({ message: "RepaymentSchedule ID is required" });
        }

        if (!status) {
            return res.status(400).json({ meesage: "Status is required" })
        }

        const repaymentSchedule = await RepaymentSchedule.findById(id);
        if (!repaymentSchedule) {
            return res.status(404).json({ message: "RepaymentSchedule not found" });
        }

        const oldStatus = repaymentSchedule.status;
        repaymentSchedule.status = status;

        if (oldStatus == "Paid" && status == "PartiallyPaid") {
            if (!amount) {
                return res.status(400).json({ message: "Amount is required for PartiallyPaid status" });
            }
        } else if (oldStatus == "PartiallyPaid" && status == "Paid") {
            if (!amount) {
                return res.status(400).json({ message: "Amount is required for Paid status" });
            }
        }

        // Reset amount to originalAmount when changing from a paid state to a non-paid state
        const paidStates = ["Paid", "PartiallyPaid", "OverduePaid", "AdvancePaid"];
        if (paidStates.includes(oldStatus) && !paidStates.includes(status)) {
            console.log('Resetting amount to originalAmount')
            repaymentSchedule.amount = repaymentSchedule.originalAmount;
        } else if (amount !== undefined) {
            console.log('Setting amount to new amount', amount)
            repaymentSchedule.amount = amount;
        }

        console.log('Going for advance logic')
        const returnResponse = await handleAdvancedLogic(
            repaymentSchedule,
            oldStatus,
            status,
            {
                paymentDate,
                amount: repaymentSchedule.amount,
                paymentMethod,
                penaltyAmount,
                penaltyReason,
                penaltyAppliedDate,
                transactionId,
                collectedBy
            }
        );

        await repaymentSchedule.save();
        res.status(200).json({ status: 'success', message: `RepaymentSchedule status updated to ${status} and message if any ${returnResponse}`, repaymentSchedule });
    } catch (error) {
        console.error("Error in updateRepaymentSchedule:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};
async function handleAdvancedLogic(repaymentSchedule, oldStatus, newStatus, data) {
    const loan = await Loan.findById(repaymentSchedule.loan);
    if (!loan) {
        throw new Error("Associated loan not found");
    }

    switch (oldStatus) {
        case "Pending":
            await handlePendingToOthers(repaymentSchedule, newStatus, data, loan);
            break;
        case "Paid":
            await handlePaidToOthers(repaymentSchedule, newStatus, data, loan);
            break;
        case "PartiallyPaid":
            await handlePartiallyPaidToOthers(repaymentSchedule, newStatus, data, loan);
            break;
        case "Overdue":
            await handleOverdueToOthers(repaymentSchedule, newStatus, data, loan);
            break;
        case "AdvancePaid":
            await handleAdvancePaidToOthers(repaymentSchedule, newStatus, data, loan);
            break;
        case "OverduePaid":
            await handleOverduePaidToOthers(repaymentSchedule, newStatus, data, loan);
            break;
        case "Waived":
            await handleWaivedToOthers(repaymentSchedule, newStatus, data, loan);
            break;
    }
}

async function handlePendingToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Paid":
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, loan, data.paymentMethod, data.transactionId);
            break;
        case "PartiallyPaid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date, amount, and method are required for Paid or PartiallyPaid status");
            }
            console.log('Pending To PartiallyPaid');
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, loan, data.paymentMethod, data.transactionId);
            await createPenalty(repaymentSchedule, loan, data.penaltyAmount, data.penaltyReason, data.penaltyAppliedDate);
            break;
        case "Overdue":
            await createPenalty(repaymentSchedule, loan, data.penaltyAmount, data.penaltyReason, data.penaltyAppliedDate);
            break;
        case "AdvancePaid":
            if (!data.paymentDate || !data.amount || !data.paymentMethod) {
                throw new Error("Payment date, amount, and method are required for AdvancePaid status");
            }
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, loan, data.paymentMethod, data.transactionId);
            break;
        case "OverduePaid":
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, loan, data.paymentMethod, data.transactionId);
            await createPenaltyIfNotExists(repaymentSchedule, loan, data.penaltyAmount, data.penaltyReason, data.penaltyAppliedDate);
            break;
        case "Waived":
            // No action needed for waived status
            break;
    }
}


async function handlePaidToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Pending":
            await removeRepayment(repaymentSchedule);
            break;
        case "PartiallyPaid":
            if (!data.amount) {
                throw new Error("Amount is required for PartiallyPaid status");
            }
            console.log('Paid To PartiallyPaid');
            await updateRepaymentAmount(repaymentSchedule, data.amount, data.transactionId);;
            await createPenaltyIfNotExists(repaymentSchedule, loan, data.penaltyAmount, data.penaltyReason, data.penaltyAppliedDate);
            break;
        case "Overdue":
            await removeRepayment(repaymentSchedule);
            await createPenalty(repaymentSchedule, loan);
            break;
        case "AdvancePaid":
            if (!data.paymentDate) {
                throw new Error("Payment date is required for AdvancePaid status");
            }
            await updateRepaymentDate(repaymentSchedule, data.paymentDate, data.transactionId);
            break;
        case "OverduePaid":
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "Waived":
            await removeRepayment(repaymentSchedule);
            break;
    }
}


async function handlePartiallyPaidToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Pending":
            await removeRepayment(repaymentSchedule);
            await removePenalty(repaymentSchedule);
            break;
        case "Paid":
            await removePenalty(repaymentSchedule);
            await updateRepaymentAmount(repaymentSchedule, data.amount, data.transactionId);;
            break;
        case "Overdue":
            await removeRepayment(repaymentSchedule);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "AdvancePaid":
            await removePenalty(repaymentSchedule);
            await updateRepaymentDateAndAmount(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            break;
        case "OverduePaid":
            await updateRepaymentAmount(repaymentSchedule, data.amount, data.transactionId);;
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "Waived":
            await removeRepayment(repaymentSchedule);
            await removePenalty(repaymentSchedule);
            break;
    }
}

async function handleOverdueToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Pending":
            await removePenalty(repaymentSchedule);
            break;
        case "Paid":
            if (!data.paymentDate || !loan || !data.paymentMethod) {
                throw new Error("Payment date, loan, and payment method are required");
            }
            console.log('Overdue To Paid: Loan is', loan);
            await removePenalty(repaymentSchedule);
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, loan, data.paymentMethod, data.transactionId);
            break;
        case "PartiallyPaid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date and amount are required");
            }
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "AdvancePaid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date and amount are required");
            }
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            await removePenalty(repaymentSchedule);
            break;
        case "OverduePaid":
            if (!data.paymentDate) {
                throw new Error("Payment date and amount are required");
            }
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            break;
        case "Waived":
            await removePenalty(repaymentSchedule);
            break;
    }
}

async function handleAdvancePaidToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Pending":
            await removeRepayment(repaymentSchedule);
            break;
        case "Paid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date and amount are required");
            }
            await updateRepaymentDateAndAmount(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            break;
        case "PartiallyPaid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date and amount are required");
            }
            await updateRepaymentDateAndAmount(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "Overdue":
            await removeRepayment(repaymentSchedule);
            await createPenaltyIfNotExists(repaymentSchedule, loan);

        case "OverduePaid":
            await updateRepaymentDateAndAmount(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "Waived":
            await removeRepayment(repaymentSchedule);
            break;
    }
}

async function handleOverduePaidToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Pending":
            await removeRepayment(repaymentSchedule);
            await removePenalty(repaymentSchedule);
            break;
        case "Paid":
            await removePenalty(repaymentSchedule);
            break;
        case "PartiallyPaid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date and amount are required");
            }
            await updateRepaymentAmount(repaymentSchedule, data.amount, data.transactionId);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "Overdue":
            await removeRepayment(repaymentSchedule);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "AdvancePaid":
            await removePenalty(repaymentSchedule);
            await updateRepaymentDateAndAmount(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            break;
        case "Waived":
            await removeRepayment(repaymentSchedule);
            await removePenalty(repaymentSchedule);
            break;
    }
}

async function handleWaivedToOthers(repaymentSchedule, newStatus, data, loan) {
    switch (newStatus) {
        case "Pending":
            // No action needed
            break;
        case "Paid":
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            break;
        case "PartiallyPaid":
            if (!data.paymentDate || !data.amount) {
                throw new Error("Payment date and amount are required");
            }
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
        case "AdvancePaid":
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            break;
        case "Overdue":
            await createPenalty(repaymentSchedule, loan);
            break;
        case "OverduePaid":
            await createRepayment(repaymentSchedule, data.paymentDate, data.amount, data.transactionId, loan);
            await createPenaltyIfNotExists(repaymentSchedule, loan);
            break;
    }
}


async function createPenalty(repaymentSchedule, loan, penaltyAmount, reason, appliedDate) {
    const newPenalty = new Penalty({
        loan: loan._id,
        repaymentSchedule: repaymentSchedule._id,
        amount: penaltyAmount || calculatePenaltyAmount(repaymentSchedule),
        reason: reason || "Overdue Payment",
        appliedDate: appliedDate || new Date()

    });
    console.log("createPenalty: Penalty created successfully");
    await newPenalty.save();
    repaymentSchedule.penalty = newPenalty._id;
    repaymentSchedule.penaltyApplied = true;
}


async function removeRepayment(repaymentSchedule) {
    console.log("removeRepayment: Start of function");
    console.log("removeRepayment: Repayment schedule object:", JSON.stringify(repaymentSchedule, null, 2));

    if (repaymentSchedule.repayments.length > 0) {
        console.log("removeRepayment: Repayments to be deleted:", JSON.stringify(repaymentSchedule.repayments, null, 2));

        // Fetch the repayments to get the total amount paid
        const repayments = await Repayment.find({ _id: { $in: repaymentSchedule.repayments } });
        const totalAmountPaid = repayments.reduce((sum, repayment) => sum + repayment.amount, 0);

        // Deleting repayments from DB
        await Repayment.deleteMany({ _id: { $in: repaymentSchedule.repayments } });
        console.log("removeRepayment: Repayments deleted successfully");

        // Emptying the repayments array
        repaymentSchedule.repayments = [];
        console.log("removeRepayment: repaymentSchedule.repayments is now empty:", repaymentSchedule.repayments);

        // Fetching the loan related to the repayment schedule
        let loan = await Loan.findById(repaymentSchedule.loan);
        console.log("removeRepayment: Fetched loan object:", JSON.stringify(loan, null, 2));

        // Logging current loan amounts
        console.log("removeRepayment: Loan outstandingAmount before update:", loan.outstandingAmount);
        console.log("removeRepayment: Loan totalPaid before update:", loan.totalPaid);

        // Updating the loan details
        loan.outstandingAmount += totalAmountPaid;
        loan.totalPaid -= totalAmountPaid;

        // Ensure totalPaid doesn't go below 0
        loan.totalPaid = Math.max(0, loan.totalPaid);

        // Logging updated loan amounts
        console.log("removeRepayment: Loan outstandingAmount after update:", loan.outstandingAmount);
        console.log("removeRepayment: Loan totalPaid after update:", loan.totalPaid);

        // Saving the loan back to the DB
        await loan.save();
        console.log("removeRepayment: Loan details saved successfully");
    } else {
        console.log("removeRepayment: No repayments to delete, skipping deletion.");
    }

    console.log("removeRepayment: End of function");
}



async function updateRepaymentAmount(repaymentSchedule, amount, transactionId) {
    // Validate that amount is provided and is a number
    if (amount === undefined || typeof amount !== 'number') {
        throw new Error("Repayment amount is required and must be a valid number");
    }

    if (repaymentSchedule.repayments.length > 0) {
        const repayment = await Repayment.findById(repaymentSchedule.repayments[0]);

        if (repayment) {
            // Fetch the loan document with await
            let loanCheck = await Loan.findById(repaymentSchedule.loan);

            if (!loanCheck) {
                throw new Error("Loan not found");
            }

            // Add logs to check loan object
            console.log("Loan before update:", loanCheck);

            // Subtract previous repayment amount from loan
            loanCheck.totalPaid -= repayment.amount;
            loanCheck.outstandingAmount += repayment.amount;

            // Update repayment amount
            repayment.amount = amount;

            repayment.status = 'Pending'
            repayment.transactionId = transactionId || null;

            // Add new repayment amount to loan
            loanCheck.totalPaid += repayment.amount;
            loanCheck.outstandingAmount -= repayment.amount;

            // Logs to verify updated values before saving
            console.log("Loan after update:", loanCheck);

            // Save the updated repayment and loan
            await repayment.save();
            const updatedLoan = await loanCheck.save(); // Capture result

            console.log("Updated loan:", updatedLoan); // Verify loan is saved
        }
    }
}



async function updateRepaymentDate(repaymentSchedule, paymentDate, transactionId) {
    if (!paymentDate) {
        throw new Error("Payment date is required");
    }
    console.log('Update Payment date to: ', paymentDate)

    if (repaymentSchedule.repayments.length > 0) {

        const repayment = await Repayment.findById(repaymentSchedule.repayments[0]);
        if (repayment) {
            repayment.paymentDate = paymentDate;
            repayment.status = 'Pending'
            repayment.transactionId = transactionId || null;
            await repayment.save();
        }
    }
}

async function updateRepaymentDateAndAmount(repaymentSchedule, paymentDate, amount, transactionId) {
    if (!paymentDate || !amount) {
        throw new Error("Payment date and amount are required");
    }
    if (repaymentSchedule.repayments.length > 0) {
        const repayment = await Repayment.findById(repaymentSchedule.repayments[0]);
        if (repayment) {

            let loanCheck = await Loan.findById(repaymentSchedule.loan);
            if (!loanCheck) {
                throw new Error("Loan not found");
            }

            loanCheck.totalPaid -= repayment.amount;
            loanCheck.outstandingAmount += repayment.amount;

            repayment.amount = amount;
            repayment.paymentDate = paymentDate;
            repayment.status = 'Pending'
            repayment.transactionId = transactionId || null;

            loanCheck.totalPaid += repayment.amount;
            loanCheck.outstandingAmount -= repayment.amount;

            console.log("Loan after update:", loanCheck);

            await repayment.save();
            const updatedLoan = await loanCheck.save(); // Capture result

            console.log("Updated loan:", updatedLoan); // Verify loan is saved
        }
    }
}

async function createPenaltyIfNotExists(repaymentSchedule, loan) {
    if (!repaymentSchedule.penalty) {
        console.log("Creating penalty since it doesn't exist for repayment schedule:", repaymentSchedule._id);
        await createPenalty(repaymentSchedule, loan);
    }
}
async function removePenalty(repaymentSchedule) {
    if (repaymentSchedule.penalty) {
        console.log("Removing penalty:", repaymentSchedule.penalty);
        const deletePenalty = await Penalty.deleteOne(repaymentSchedule.penalty);
        console.log('Deleted penalty', deletePenalty);
        repaymentSchedule.penalty = null;
        repaymentSchedule.penaltyApplied = false;
    } else {
        console.log("No penalty found for repayment schedule:", repaymentSchedule._id);
    }
}

// Update the createRepayment function to handle the case when a repayment already exists
async function createRepayment(repaymentSchedule, paymentDate, amount, loan, paymentMethod, transactionId, collectedBy) {
    if (repaymentSchedule.repayments.length > 0) {
        console.log("Repayments already exists");
        // Update existing repayment
        const existingRepayment = await Repayment.findById(repaymentSchedule.repayments[0]);
        if (existingRepayment) {
            console.log("Repayment exists for this repayment schedule", existingRepayment);
            existingRepayment.amount = amount || existingRepayment.amount;
            existingRepayment.paymentDate = paymentDate || existingRepayment.paymentDate;
            existingRepayment.paymentMethod = paymentMethod || existingRepayment.paymentMethod;
            existingRepayment.transactionId = transactionId || existingRepayment.transactionId;
            existingRepayment.collectedBy = collectedBy || existingRepayment.collectedBy;
            existingRepayment.status = "Pending";
            existingRepayment.balanceAfterPayment = loan.outstandingAmount - amount;
            await existingRepayment.save();
            return;
        }
    }

    let message = "";

    // Set default values if not provided
    amount = amount || repaymentSchedule.amount;
    paymentDate = paymentDate || repaymentSchedule.paymentDate;
    paymentMethod = paymentMethod || "Cash";
    transactionId = transactionId || null;
    collectedBy = collectedBy || null;

    if (!loan || typeof loan.outstandingAmount !== 'number') {
        throw new Error("Invalid loan object or missing outstandingAmount");
    }

    const balanceAfterPayment = loan.outstandingAmount - amount;

    console.log(`Balance After Repayment: ${balanceAfterPayment}`);
    console.log("Creating new repayment");
    const newRepayment = new Repayment({
        repaymentSchedule: repaymentSchedule._id,
        amount: amount,
        paymentDate: paymentDate,
        paymentMethod: paymentMethod,
        transactionId: transactionId,
        loan: loan._id,
        status: "Pending",
        balanceAfterPayment: balanceAfterPayment,
        collectedBy: collectedBy
    });

    console.log("Saving new repayment");
    await newRepayment.save();
    console.log("Adding new repayment to repaymentSchedule");
    repaymentSchedule.repayments.push(newRepayment._id);

    console.log("Updating loan");
    loan.outstandingAmount = balanceAfterPayment;
    loan.totalPaid = (loan.totalPaid || 0) + amount;
    await loan.save();
    console.log("Successfully updated loan");

    return message;
}
function calculatePenaltyAmount(repaymentSchedule) {
    return repaymentSchedule.originalAmount * 0.1; // 10% of the scheduled amount as penalty
}

function calculateBalanceAfterPayment(loan, amount) {
    console.log("Loan : ", loan);
    console.log("OutStanding Amount : ", loan.outstandingAmount);
    console.log("Amount : ", amount);
    console.log("OutStanding Amount - Amount : ", loan.outstandingAmount - amount);
    return loan.outstandingAmount - amount;
}

/*

Repayment Schedule Update Logic Explanation
Overview
This code handles the updating of repayment schedules in a loan management system. It allows for changing the status of a repayment schedule and performs various actions based on the status change.
Main Function: updateRepaymentSchedule
Purpose
Updates a repayment schedule based on the provided data.
Parameters

req: The request object containing the update data
res: The response object to send back the result

Process

Extracts data from the request body
Validates the presence of required fields (id and status)
Finds the repayment schedule by ID
Updates the status
If advanced logic is requested, calls handleAdvancedLogic
Saves the updated repayment schedule
Sends a success response or an error if something goes wrong

Advanced Logic Handler: handleAdvancedLogic
Purpose
Manages the complex logic for status transitions.
Parameters

repaymentSchedule: The repayment schedule being updated
oldStatus: The previous status
newStatus: The new status
data: Additional data for the update (e.g., payment details)

Process

Finds the associated loan
Calls the appropriate handler function based on the old status

Status Transition Handlers
There are several handler functions, each managing transitions from a specific status:

handlePendingToOthers
handlePaidToOthers
handlePartiallyPaidToOthers
handleOverdueToOthers
handleAdvancePaidToOthers
handleOverduePaidToOthers
handleWaivedToOthers

Each of these functions contains switch statements to handle transitions to various new statuses.
Key Operations
Creating a Repayment

Function: createRepayment
Creates a new repayment record or updates an existing one
Calculates the balance after payment

Creating a Penalty

Function: createPenalty
Creates a new penalty record for overdue payments

Removing a Repayment

Function: removeRepayment
Deletes associated repayment records

Updating Repayment Details

Functions: updateRepaymentAmount, updateRepaymentDate, updateRepaymentDateAndAmount
Modify existing repayment records

Handling Penalties

Functions: createPenaltyIfNotExists, removePenalty
Manage the creation and removal of penalty records

Status Transitions and Actions
Here's a summary of the main status transitions and their associated actions:

Pending to:

Paid/PartiallyPaid: Create repayment
Overdue: Create penalty
AdvancePaid: Create repayment
OverduePaid: Create repayment and penalty
Waived: No action


Paid to:

Pending: Remove repayment
PartiallyPaid: Update repayment amount, create penalty if not exists
Overdue: Remove repayment, create penalty
AdvancePaid: Update repayment date
OverduePaid: Create penalty if not exists
Waived: Remove repayment


PartiallyPaid to:

Pending: Remove repayment
Paid: Update repayment amount
Overdue: Update repayment amount, create penalty if not exists
AdvancePaid: Update repayment date and amount
OverduePaid: Update repayment amount, create penalty if not exists
Waived: Remove repayment


Overdue to:

Pending: Remove penalty
Paid/PartiallyPaid: Create repayment
AdvancePaid: Create repayment, remove penalty
OverduePaid: Create repayment
Waived: Remove penalty


AdvancePaid to:

Pending/Paid/PartiallyPaid/Overdue/OverduePaid: Update repayment date and amount
Overdue/OverduePaid: Also create penalty if not exists
Waived: Remove repayment


OverduePaid to:

Pending: Remove repayment and penalty
Paid/PartiallyPaid: Update repayment amount, remove penalty
Overdue: Remove repayment
AdvancePaid: Update repayment date and amount, remove penalty
Waived: Remove repayment and penalty


Waived to:

Pending: No action
Paid/PartiallyPaid/AdvancePaid: Create repayment
Overdue: Create penalty
OverduePaid: Create repayment and penalty if not exists



Conclusion
This system provides a flexible way to manage repayment schedules, handling various status transitions and associated actions. It ensures that repayments, penalties, and loan balances are updated appropriately based on the status changes, maintaining the integrity of the loan management system.


*/

// FUTURE LOGIC FOR REPAYMENT SECHEDULE UPDATE
// Below Logic is only should be applied if user opted in for it which we can determine if (advanceLogic === true)
// if it is not then, we just update repayment sechedule normally
//
// First of You have to understand that Repayment and Repayment Schedule are different
// Repayments store actual payments and Repayment Schedules store schedules for payments
// If User is updating status, we a few conditions
// Whenever we create or update something, user should be providing details for it he doesn't throw error
//  [Pending To Others]
// 1. if status is going from Pending to Paid then we will need to create Repayments
//      (A) Then there should be a date of when the payment was done (paymentDate)
//          if(paymentDate) is provided and is different from Repayment Schedule dueDate
//          (Make sure both dates type is same for example, ISO, you can detct one and convert other) then the below things would be required
//          Status of that repayment(Defaults to Pending), amount, paymentDate, paymentMethod, and loanId
//
// 2. if status Pending to PartiallyPaid then, same as point 1
// 3. if status is going from Pending to Overdue then
//      (A) we will create Penalty
//          In Penalty what is required is loanId (loan) repaymentScheduleId (repayment schedule) and amount of penalty, and reason (which we ourself can set to "Overdue Payment")
// 4. if status is going from Pending to AdvancePaid then
//      (A) paymentDate has to be provided
// 5. if status is going from Pending to OverduePaid then, we have to do combination of point 1 and point 3
//      (A) check if Repayment exists for this loan if it doesn't exsits then we will create one (like point 1)
//      (B) Check if Penalty already exists for this Repayment Sechedule
//          if Penalty exists then good (Dont change anything in it)
//          else we will create Penalty, for appliedDate, you can set it to current date if not provided
//
// 6. if status is going from Pending to wavied then we don't have to do anyting
//
//  [Paid to Others]
// 7. if status is going from Paid to Pending
//      (A) Remove Repayment for this Sechedule if it exsists
// 8. if stauts is going from Paid to PartiallyPaid
//      (A) Check if Repayment exists for this Sechedule
//          if it exists then we will update it to amount which is provided
//          if user doesn't provide amount then just return Repayment Amount is required
//      (B) check if Penalty exists for this Sechedule else
//          create a Penalty for this Sechedule
//
// 9. if status is going from Paid to Overdue
//      (A) Check if Repayment exists for this Sechedule
//          if it exists then remove it
//      (B) Create Penalty for this Sechedule
// 10. if status is going from Paid to AdvancePaid
//      (A) check if Repayment exists for this Sechedule
//          if it exists then, update the date of repayment (which has be provided)
// 11. if status is going from Paid to OverduePaid
//      (A) check if Repayment exists for this Sechedule
//
//      (B) Create Penalty for this Sechedule
// 12. if status is going from Paid to Waved
//      (A) check if Repayment exists for this Sechedule
//          if it exists then remove it
//
//
// 13. if status is going from PartiallyPaid to Pending
// and more cases Please write them up don't leave them out
//     