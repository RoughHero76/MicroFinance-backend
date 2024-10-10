const mongoose = require("mongoose");

const lastSeenSchema = new mongoose.Schema({
    adminid: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
    },
    employeeid: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
    },
    date: {
        type: Date,
        default: Date.now,
        expires: '7d'  // Document will automatically expire 30 days after this date
    },
    accuracy: {
        type: Number
    },
    address: {
        type: String
    }
});

module.exports = mongoose.model("LastSeen", lastSeenSchema);
