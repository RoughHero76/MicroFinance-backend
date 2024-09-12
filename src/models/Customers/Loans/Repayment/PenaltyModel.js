//src/models/Customers/Loans/Repayment/PenaltyModel.js
const mongoose = require('mongoose');
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

const Penalty = mongoose.model('Penalty', penaltySchema);
module.exports = Penalty;