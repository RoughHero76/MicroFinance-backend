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
    paymentDate: {
        type: Date,
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount must be a positive number']
    },
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'PartiallyPaid', 'Overdue'],
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

    originalAmount: {
        type: Number
    },
    repaymentSchedules: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RepaymentSchedule'
    }],

    repayments: {
        type: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Repayment'
        }]
    },

    collectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
    },

    loanInstallmentNumber: {
        type: Number,
    },

}, { timestamps: true });
// Add a virtual field
repaymentScheduleSchema.virtual('isOverdue').get(function () {
    return this.status === 'Overdue';
});

// Add a method
repaymentScheduleSchema.methods.calculatePenalty = function () {
    // Implement penalty calculation logic here
};

// Add an index
repaymentScheduleSchema.index({ loan: 1, dueDate: 1 });


const RepaymentSchedule = mongoose.model('RepaymentSchedule', repaymentScheduleSchema);
module.exports = RepaymentSchedule;