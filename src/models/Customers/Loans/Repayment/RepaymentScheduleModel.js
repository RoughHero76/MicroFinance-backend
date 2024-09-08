// src/models/customer/loans/repayment/repaymentScheduleModel.js

const mongoose = require('mongoose');

const repaymentScheduleSchema = new mongoose.Schema({
    dueDate: {
        type: Date,
        required: true
    },
    paidBeforeDueDate: {
        type: Boolean,
        default: null
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount must be a positive number']
    },
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue'],
        default: 'Pending'
    },
    peneltyApplied: {
        type: Boolean,
        default: false
    },
    penalty: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = repaymentScheduleSchema;