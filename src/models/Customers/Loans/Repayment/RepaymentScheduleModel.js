// src/models/Customers/Loans/Repayment/repaymentScheduleModel.js
const mongoose = require('mongoose');

const repaymentScheduleSchema = new mongoose.Schema({
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    dueDate: {
        type: Date,
        required: true
    },
    paymentDate: Date,
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount must be a positive number']
    },
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'PartiallyPaid', 'PartiallyPaidFullyPaid', 'Overdue', 'AdvancePaid', 'OverduePaid', 'Waived'],
        default: 'Pending'
    },
    penaltyApplied: {
        type: Boolean,
        default: false
    },
    penalty: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Penalty'
    },
    originalAmount: Number,
    repayments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Repayment'
    }],
    collectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    },
    logicNote: {
        type: String
    },
    loanInstallmentNumber: Number
}, { timestamps: true });

repaymentScheduleSchema.virtual('isOverdue').get(function () {
    return this.status === 'Overdue';
});

repaymentScheduleSchema.index({ loan: 1, dueDate: 1 });

const RepaymentSchedule = mongoose.model('RepaymentSchedule', repaymentScheduleSchema);
module.exports = RepaymentSchedule;