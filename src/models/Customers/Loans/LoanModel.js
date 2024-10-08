// src/models/Customers/Loans/loanModel.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const loanSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true,
        default: uuidv4
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    loanAmount: {
        type: Number,
        required: true,
        min: [0, 'Loan amount must be a positive number']
    },
    principalAmount: {
        type: Number,
        required: true,
        min: [0, 'Principal amount must be a positive number']
    },
    loanDuration: {
        type: String,
        enum: ['100 days', '200 days', '300 days'],
        required: true
    },
    numberOfInstallments: {
        type: Number,
        required: true,
        min: [1, 'Number of installments must be at least 1']
    },
    installmentFrequency: {
        type: String,
        enum: ['Daily', 'Weekly', 'Monthly'],
        required: true
    },
    interestRate: {
        type: Number,
        required: true,
        min: [0, 'Interest rate must be a positive number']
    },
    documents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Document'
    }],
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'Active', 'Closed'],
        default: 'Pending'
    },
    loanStartDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    loanEndDate: {
        type: Date,
        required: true
    },
    loanClosedDate: Date,
    repaymentAmountPerInstallment: {
        type: Number,
        required: true,
        min: [0, 'Repayment amount must be a positive number']
    },
    totalPaid: {
        type: Number,
        default: 0
    },
    outstandingAmount: {
        type: Number,
        default: 0
    },
    totalPenalty: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Penalty'
    }],
    totalPenaltyAmount: {
        type: Number,
        default: 0
    },
    loanType: {
        type: String,
        enum: ['Personal', 'Business', 'Other'],
        default: 'Personal'
    },
    loanNumber: {
        type: String,
        unique: true
    },
    businessFirmName: String,
    businessAddress: String,
    businessPhone: String,
    businessEmail: String,
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    }
}, { timestamps: true });

loanSchema.index({ loanNumber: 1 });  // Ascending order index
loanSchema.index({ uid: 1 });         // Ascending order index

const Loan = mongoose.model('Loan', loanSchema);

module.exports = Loan;