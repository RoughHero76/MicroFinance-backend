// src/models/Customers/Loans/DocumentsModel.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const documentSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true,
        default: uuidv4
    },
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    documentName: {
        type: String,
        required: true
    },
    documentUrl: {
        type: String,
        required: true
    },
    documentType: {
        type: String,
        enum: ['Id Proof', 'Bank', 'Goverment', 'Photo', 'Signature', 'Other'],
        required: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    }
}, { timestamps: true });

const Document = mongoose.model('Document', documentSchema);


module.exports = Document;


