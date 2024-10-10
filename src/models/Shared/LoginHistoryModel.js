const mongoose = require("mongoose");

const loginHistorySchema = new mongoose.Schema({
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
        expires: '15d' 
    },
    accuracy: {
        type: Number
    },
    address: {
        type: String
    }
});

loginHistorySchema.index({ date: 1 });

module.exports = mongoose.model("LoginHistory", loginHistorySchema);
