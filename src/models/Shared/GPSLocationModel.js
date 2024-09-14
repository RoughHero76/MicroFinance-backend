//src/models/Shared/GPSLocationModel.js

const mongoose = require("mongoose");

const gpsLocationSchema = new mongoose.Schema({
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
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
        default: Date.now
    },
    accuracy: {
        type: Number
    },
    address: {
        type: String
    },
    typeOf: {
        type: String,
        enum: ['Employee', 'Admin'],
    }

});

module.exports = mongoose.model("GPSLocations", gpsLocationSchema);

