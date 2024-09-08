const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { addDays } = require('date-fns');
const repaymentScheduleSchema = require('./repayment/repaymentScheduleModel');

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
        stampPaper: {
            type: String,
            required: true
        },
        promissoryNote: {
            type: String,
            required: true
        },
        stampPaperPhotoLink: {
            type: String,
            required: true
        },
        promissoryNotePhotoLink: {
            type: String,
            required: true
        },
        blankPaper: {
            type: String,
            required: true
        },
        cheques: [{
            photoLink: String
        }],
        chequesDetails: [{
            number: String,
            bankName: String,
            accountNumber: String,
            ifsc: String
        }],
        governmentIdsFront: [{
            photoLink: String
        }],
        governmentIdsBack: [{
            photoLink: String
        }],
        governmentIdsDetails: [{
            type: {
                type: String,
                enum: ['Aadhar', 'PAN', 'Driving License', 'Voter ID', 'Passport']
            },
            number: String,
            imageUrl: String
        }]
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'Active', 'Closed'],
        default: 'Pending'
    },
    repaymentSchedule: [repaymentScheduleSchema],
    loanStartDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    loanEndDate: {
        type: Date,
        required: true
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
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('Loan', loanSchema);