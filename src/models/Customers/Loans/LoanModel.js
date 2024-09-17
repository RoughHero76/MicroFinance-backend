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
    documents: {
        stampPaper: String,
        promissoryNote: String,
        stampPaperPhotoLink: String,
        promissoryNotePhotoLink: String,
        blankPaper: String,
        cheques: [{
            photoLink: String,
            number: String,
            bankName: String,
            accountNumber: String,
            ifsc: String
        }],
        governmentIds: [{
            type: {
                type: String,
                enum: ['Aadhar', 'PAN', 'Driving License', 'Voter ID', 'Passport']
            },
            number: String,
            frontPhotoLink: String,
            backPhotoLink: String
        }]
    },
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
    loanClosedDate: {
        type: Date
    
    },
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
    totalPenalty: {
        type: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Penalty'
        }]
    },
    totalPenaltyAmmount: {
        type: Number,
        default: 0
    },
    loanType: {
        type: String,
        enum: ['Personal', 'Business', 'Other'],
        default: 'Personal'
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    }
}, { timestamps: true });

const Loan = mongoose.model('Loan', loanSchema);
module.exports = Loan;