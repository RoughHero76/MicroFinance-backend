// src/cron/LoanStatusCron.js
const Loan = require('../models/Customers/Loans/LoanModel');
const LoanStatus = require('../models/Customers/Loans/loanStatusModel');
const RepaymentSchedule = require('../models/Customers/Loans/Repayment/RepaymentScheduleModel');

const updateLoanStatuses = async () => {
    try {
        const loans = await Loan.find({ status: 'Active' });

        for (const loan of loans) {
            const overdueSchedules = await RepaymentSchedule.find({
                loan: loan._id,
                status: 'Overdue'
            });

            let loanStatus = await LoanStatus.findOne({ loan: loan._id });

            if (!loanStatus) {
                loanStatus = new LoanStatus({ loan: loan._id });
            }
            loanStatus.repaymentSchedules = overdueSchedules.map(schedule => schedule._id);
            loanStatus.totalOverdue = overdueSchedules.reduce((total, schedule) => total + schedule.amount, 0);
            // This will trigger the updateStatus method defined in the LoanStatus model
            await loanStatus.save();
          
        }

        console.log('Loan status update completed');
    } catch (error) {
        console.error('Error updating loan statuses:', error);
    }
};

module.exports = {
    updateLoanStatuses
};