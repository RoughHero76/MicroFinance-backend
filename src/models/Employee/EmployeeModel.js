//src/models/Employee/EmployeeModel.js
const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
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

    role:{
        type: String,
        default: "employee"
    },

    accountStatus: {
        type: Boolean,
        default: true
    },

    isDeleted:{
        type: Boolean,
        default: false
    },

    lastLogin: { 
        type: Date, default: Date.now 
    },

    loginHistory: { 
        type: Array, default: [] 
    }
}, { timestamps: true });

// Pre-save middleware to hash password and generate UID
employeeSchema.pre('save', async function(next) {
    
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
employeeSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Employee", employeeSchema);
    
