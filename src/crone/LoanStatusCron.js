// src/cron/LoanStatusCron.js
const Loan = require('../models/Customers/Loans/LoanModel');
const LoanStatus = require('../models/Customers/Loans/loanStatusModel');
const RepaymentSchedule = require('../models/Customers/Loans/Repayment/RepaymentScheduleModel');

const updateLoanStatuses = async () => {
    try {
        // Get all active loan statuses
        const loanStatuses = await LoanStatus.find({ status: 'Active' });

        for (const loanStatus of loanStatuses) {
            // Check if loan exists and is active
            const loan = await Loan.findById(loanStatus.loan);
            
            if (!loan || loan.status !== 'Active') {
                // Mark loan status as completed/deleted based on loan status
                loanStatus.status = loan ? loan.status : 'Deleted';
                await loanStatus.save();
                continue;
            }

            // Get current overdue schedules
            const overdueSchedules = await RepaymentSchedule.find({
                loan: loan._id,
                status: 'Overdue'
            });

            // Update loan status
            loanStatus.repaymentSchedules = overdueSchedules.map(schedule => schedule._id);
            loanStatus.totalOverdue = overdueSchedules.reduce((total, schedule) => total + schedule.amount, 0);
            await loanStatus.save();
        }

        console.log('Loan status update completed');
    } catch (error) {
        console.error('Error updating loan statuses:', error);
    }
};

const updateLoanStatusesReq = async (req, res) => {
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
        res.status(200).json({ message: 'Loan status update completed' });

        console.log('Loan status update completed');
    } catch (error) {
        console.error('Error updating loan statuses:', error);
        res.status(500).json({ error: 'Failed to update loan statuses' });
    }
};


module.exports = {
    updateLoanStatuses,
    updateLoanStatusesReq
};