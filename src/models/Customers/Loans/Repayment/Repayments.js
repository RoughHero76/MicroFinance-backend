// src/models/Customers/Loans/Repayment/repaymentModel.js
const mongoose = require('mongoose');

const repaymentSchema = new mongoose.Schema({
    repaymentSchedule: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RepaymentSchedule',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount must be a positive number']
    },
    paymentDate: {
        type: Date,
        default: Date.now
    },
    paymentMethod: {
        type: String,
        enum: ['Cash', 'Bank Transfer', 'Cheque', 'Other'],
        required: true
    },
    transactionId: {
        type: String
    },
    status: {
        type: String,
        enum: ['Pending', 'Processed', 'Failed'],
        default: 'Pending'
    },
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
    },
    balanceAfterPayment: {
        type: Number
    },
    collectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
    },
}, { timestamps: true });

const Repayment = mongoose.model('Repayment', repaymentSchema);
module.exports = Repayment;