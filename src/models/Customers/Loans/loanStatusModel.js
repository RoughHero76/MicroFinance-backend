const mongoose = require('mongoose');

const loanStatusSchema = new mongoose.Schema({
    loan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    smaLevel: {
        type: Number,
        enum: [0, 1, 2],
        default: 0
    },
    smaDate: {
        type: Date,
        default: Date.now
    },
    totalOverdue: {
        type: Number,
        default: 0
    },
    repaymentSchedules: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RepaymentSchedule'
    }],
    npa: {
        type: Boolean,
        default: false
    },
    defaults: {
        type: String,
        enum: ['Willing', 'Normal'],
        default: 'Normal'
    },
    smaHistory: [{
        level: Number,
        date: Date
    }],
    npaHistory: [{
        date: Date
    }]
});

// Function to update SMA level and NPA status based on repayment schedules
loanStatusSchema.methods.updateStatus = function () {
    const duesCount = this.repaymentSchedules.length;

    if (duesCount <= 5) {
        this.smaLevel = 0;
        this.npa = false;
    } else if (duesCount <= 10) {
        this.smaLevel = 1;
        this.npa = false;
    } else if (duesCount <= 15) {
        this.smaLevel = 2;
        this.npa = false;
    } else {
        this.smaLevel = 2;
        this.npa = true;
    }

    // Record SMA level change
    this.smaHistory.push({ level: this.smaLevel, date: new Date() });

    // Record NPA status change if it became NPA
    if (this.npa && (this.npaHistory.length === 0 || !this.npaHistory[this.npaHistory.length - 1].npa)) {
        this.npaHistory.push({ date: new Date() });
    }
};

// Middleware to update status before saving
loanStatusSchema.pre('save', function (next) {
    if (this.isModified('repaymentSchedules')) {
        this.updateStatus();
    }
    next();
});

module.exports = mongoose.model('LoanStatus', loanStatusSchema);