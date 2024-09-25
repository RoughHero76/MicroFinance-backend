const mongoose = require('mongoose');
const Loan = require('../LoanModel');

const penaltySchema = new mongoose.Schema({
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    repaymentSchedule: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RepaymentSchedule',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Penalty amount must be a positive number']
    },
    reason: {
        type: String,
        required: true
    },
    appliedDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'Waived'],
        default: 'Pending'
    }
}, { timestamps: true });


async function updateLoan(loanId, updateOperation) {
    const Loan = mongoose.model('Loan');
    console.log(`Updating loan ${loanId} with operation:`, updateOperation);
    try {
        const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateOperation, { new: true });
        if (!updatedLoan) {
            throw new Error(`Loan with id ${loanId} not found`);
        }
        console.log(`Successfully updated loan ${loanId}`);
        return updatedLoan;
    } catch (error) {
        console.log(`Error updating loan ${loanId}:`, error);
        throw error;
    }
}

async function addPenaltyToLoan(loanId, penaltyId, penaltyAmount) {
    console.log(`Adding penalty ${penaltyId} to loan ${loanId}`);
    return updateLoan(loanId, {
        $push: { totalPenalty: penaltyId },
        $inc: { totalPenaltyAmount: penaltyAmount }
    });
}

async function removePenaltyFromLoan(loanId, penaltyId, penaltyAmount) {
    console.log(`Removing penalty ${penaltyId} from loan ${loanId}`);
    return updateLoan(loanId, {
        $pull: { totalPenalty: penaltyId },
        $inc: { totalPenaltyAmount: -penaltyAmount }
    });
}

// Middleware to update the associated loan after saving a new penalty
penaltySchema.post('save', async function (doc, next) {
    console.log(`Post-save middleware triggered for penalty ${doc._id}`);
    try {
        await addPenaltyToLoan(doc.loan, doc._id, doc.amount);
        console.log(`Successfully added penalty ${doc._id} to loan ${doc.loan}`);
        next();
    } catch (error) {
        console.log(`Error in post-save middleware for penalty ${doc._id}:`, error);
        next(error);
    }
});

// Middleware to handle penalty removal
async function handlePenaltyRemoval(doc) {
    console.log(`Handling removal for penalty ${doc._id}`);
    try {
        await removePenaltyFromLoan(doc.loan, doc._id, doc.amount);
        console.log(`Successfully removed penalty ${doc._id} from loan ${doc.loan}`);
    } catch (error) {
        console.log(`Error handling removal for penalty ${doc._id}:`, error);
        throw error;
    }
}

// Middleware for document-level operations
penaltySchema.pre('remove', async function (next) {
    console.log(`Pre-remove middleware triggered for penalty ${this._id}`);
    await handlePenaltyRemoval(this);
    next();
});

// Middleware for query-level deleteOne and deleteMany
penaltySchema.pre('deleteOne', { document: false, query: true }, async function () {
    console.log(`Pre-deleteOne middleware triggered`);
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
        await handlePenaltyRemoval(doc);
    }
});
//Bypass Middleware for deleting loan itself
penaltySchema.pre('deleteMany', async function () {
    if (this.options.bypassMiddleware) {
        return next();
    }
});

penaltySchema.pre('FindByIdAndDelete', async function () {
    console.log(`Pre-findByIdAndDelete middleware triggered`);
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
        await handlePenaltyRemoval(doc);
    }
});

const Penalty = mongoose.model('Penalty', penaltySchema);
module.exports = Penalty;