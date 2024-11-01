const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require('uuid');

const adminSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true
    },
    fname: {
        type: String,
        required: true
    },
    lname: {
        type: String,
        required: true
    },
    email: {
        type: String
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    userName: {
        type: String,
        required: true,
        unique: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    phoneNumberVerified: {
        type: Boolean,
        default: false
    },
    password: {
        type: String,
        required: true
    },
    profilePic: {
        type: String
    },
    role: {
        type: String,
        default: "admin"
    },
    accountStatus: {
        type: String,
        default: "inactive"
    },
    isDeleted: {
        type: Boolean,
        default: false
    },

    loginHistory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LoginHistory"
    },

    fcmToken: {
        type: String
    }

}, { timestamps: true });

// Pre-save middleware to hash password and generate UID
adminSchema.pre('save', async function (next) {

    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);

        if (!this.uid) {
            this.uid = uuidv4();
        }

        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare passwords
adminSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Admin", adminSchema);