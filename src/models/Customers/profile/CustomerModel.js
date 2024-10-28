//src/models/Customers/profile/CustomerModel.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require('uuid');

const customerSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true,
        default: uuidv4
    },
    fname: {
        type: String,
        required: true
    },
    lname: {
        type: String,
        required: true
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other', 'Not Defined'],
        default: 'Not Defined'
    },
    email: {
        type: String,
        unique: true  // Added unique constraint
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    userName: {
        type: String,
        unique: true
    },
    phoneNumber: {
        type: String,
        unique: true,  // Added unique constraint
        required: true,
    },
    phoneNumberVerified: {
        type: Boolean,
        default: false
    },
    address: {
        type: String
    },
    city: {
        type: String
    },
    state: {
        type: String
    },
    country: {
        type: String
    },
    pincode: {
        type: String
    },
    password: {
        type: String
    },
    profilePic: {
        type: String
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    accountStatus: {
        type: Boolean,
        default: true
    },
    loans: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan'
    }],
    fcmToken: {
        type: String
    }
}, { timestamps: true });

customerSchema.index({ fname: 'text', lname: 'text', email: 'text', phoneNumber: 'text', userName: 'text' });

customerSchema.pre("save", async function (next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);

        next();
    } catch (error) {
        next(error);
    }
});

module.exports = mongoose.model("Customer", customerSchema);