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
        expires: '30d' 
    },
    accuracy: {
        type: Number
    },
    address: {
        type: String
    }
});

lastSeenSchema.index({ date: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("LastSeen", lastSeenSchema);
