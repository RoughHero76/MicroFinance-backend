// src/models/customer/loans/repayment/repayments.js

const mongoose = require('mongoose');

const repaymentSchema = new mongoose.Schema({
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
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
    }
}, { timestamps: true });

const Repayment = mongoose.model('Repayment', repaymentSchema);
module.exports = {
    repaymentSchema,
    Repayment
};