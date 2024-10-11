// src/models/Customers/Loans/Repayment/repaymentModel.js
const mongoose = require('mongoose');

const repaymentSchema = new mongoose.Schema({
    repaymentSchedule: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RepaymentSchedule',
        required: true
    }],
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
        enum: ['Cash', 'Bank Transfer', 'GooglePay', 'PhonePay', 'Paytm', 'Cheque', 'Other'],
        required: true
    },
    transactionId: String,
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    balanceAfterPayment: Number,
    collectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    },
    logicNote: {
        type: String
    }
}, { timestamps: true });

const Repayment = mongoose.model('Repayment', repaymentSchema);
module.exports = Repayment;